"""Database management module supporting SQLite, DuckDB, and CSV backends."""

import sqlite3
import os
import re
import logging
import threading

logger = logging.getLogger(__name__)

_duckdb = None
try:
    import duckdb as _duckdb_mod
    _duckdb = _duckdb_mod
    _has_duckdb = True
except ImportError:
    _has_duckdb = False


DUCKDB_EXTENSIONS = (".duckdb", ".ddb")
SQLITE_EXTENSIONS = (".db", ".sqlite", ".sqlite3")
CSV_EXTENSIONS = (".csv",)


def detect_db_type(file_path):
    """Detect the database type from file path."""
    lower = os.path.basename(file_path).lower()
    if lower.endswith(CSV_EXTENSIONS):
        return "csv"
    if lower.endswith(DUCKDB_EXTENSIONS):
        return "duckdb"
    if lower.endswith(SQLITE_EXTENSIONS):
        return "sqlite"
    # Magic byte detection
    try:
        with open(file_path, "rb") as f:
            header = f.read(16)
        if header[:7] == b"DUCKDB\n":
            return "duckdb"
        if header == b"SQLite format 3\0":
            return "sqlite"
    except Exception:
        pass
    return "sqlite"


def _sanitize_table_name(name):
    """Generate a valid SQL table name from a filename."""
    base = os.path.splitext(os.path.basename(name))[0]
    base = re.sub(r"[^a-zA-Z0-9_]", "_", base)
    if not base or base[0].isdigit():
        base = "_" + base
    return base


class DatabaseManager:
    """Manages database connections and operations.

    Supports SQLite (built-in), DuckDB (optional), and CSV (via DuckDB).
    Thread-safe: uses a reentrant lock to serialize access.
    """

    def __init__(self):
        self._lock = threading.RLock()
        self.connection = None
        self.db_path = None
        self.db_type = None  # 'sqlite', 'duckdb', 'csv'
        self._csv_table_name = None

    def _require_duckdb(self):
        """Return the duckdb module or raise if not installed."""
        if not _has_duckdb or _duckdb is None:
            raise RuntimeError(
                "DuckDB is not installed. Install with: pip install duckdb"
            )
        return _duckdb

    def connect(self, db_path):
        """Connect to a database file (SQLite, DuckDB) or a CSV file."""
        with self._lock:
            if not os.path.isfile(db_path):
                raise FileNotFoundError(f"Database file not found: {db_path}")
            if self.connection:
                self.disconnect()

            abs_path = os.path.abspath(db_path)
            self.db_type = detect_db_type(db_path)
            self.db_path = abs_path

            if self.db_type == "sqlite":
                self.connection = sqlite3.connect(abs_path, check_same_thread=False)
                self.connection.row_factory = sqlite3.Row

            elif self.db_type == "duckdb":
                ddb = self._require_duckdb()
                self.connection = ddb.connect(abs_path)

            elif self.db_type == "csv":
                ddb = self._require_duckdb()
                self.connection = ddb.connect()
                table_name = _sanitize_table_name(abs_path)
                self.connection.execute(
                    f'CREATE OR REPLACE VIEW "{table_name}" AS '
                    f"SELECT * FROM read_csv_auto('{abs_path}')"
                )
                self._csv_table_name = table_name

            logger.info("Connected to %s: %s", self.db_type, abs_path)
            return {"db_path": abs_path, "db_type": self.db_type, "status": "connected"}

    def disconnect(self):
        """Disconnect the current database."""
        with self._lock:
            if self.connection:
                self.connection.close()
                self.connection = None
                self.db_path = None
                self.db_type = None
                self._csv_table_name = None
                logger.info("Disconnected from database")

    def is_connected(self):
        return self.connection is not None

    def get_tables(self):
        """List all tables/views in the connected database."""
        with self._lock:
            if not self.is_connected():
                raise RuntimeError("No database connected")

            if self.db_type == "sqlite":
                cur = self.connection.cursor()
                cur.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
                )
                return [row["name"] for row in cur.fetchall()]

            elif self.db_type == "duckdb":
                result = self.connection.execute(
                    "SELECT table_name FROM information_schema.tables "
                    "WHERE table_schema='main' ORDER BY table_name"
                ).fetchall()
                return [row[0] for row in result]

            elif self.db_type == "csv":
                return [self._csv_table_name]

    def get_table_schema(self, table_name):
        """Get schema (column name and type) for a table."""
        with self._lock:
            if not self.is_connected():
                raise RuntimeError("No database connected")

            if self.db_type == "sqlite":
                cur = self.connection.cursor()
                cur.execute(f'PRAGMA table_info("{table_name}")')
                return [
                    {
                        "name": row["name"],
                        "type": row["type"],
                        "notnull": bool(row["notnull"]),
                        "pk": bool(row["pk"]),
                    }
                    for row in cur.fetchall()
                ]

            else:  # duckdb or csv
                result = self.connection.execute(
                    f'DESCRIBE "{table_name}"'
                ).fetchall()
                columns = []
                for row in result:
                    # DESCRIBE returns: column_name, column_type, null, key, default, extra
                    name = row[0]
                    col_type = str(row[1]) if row[1] else "VARCHAR"
                    is_nullable = True
                    if len(row) > 2 and row[2] is not None:
                        is_nullable = str(row[2]).lower() == "yes"
                    columns.append({
                        "name": name,
                        "type": col_type,
                        "notnull": not is_nullable,
                        "pk": False,
                    })
                return columns

    def get_table_rows(
        self, table_name, sort_by=None, sort_dir="asc",
        filters=None, page=1, per_page=100
    ):
        """Get rows from a table with optional sorting, filtering, pagination."""
        with self._lock:
            if not self.is_connected():
                raise RuntimeError("No database connected")

            sort_dir = sort_dir.lower()
            if sort_dir not in ("asc", "desc"):
                sort_dir = "asc"

            base_query = f'SELECT * FROM "{table_name}"'
            count_query = f'SELECT COUNT(*) as cnt FROM "{table_name}"'
            params = []

            where_clauses = []
            if filters:
                for f in filters:
                    col = f.get("column", "")
                    op = f.get("operator", "contains")
                    val = f.get("value", "")
                    if not col or val == "":
                        continue
                    if op == "contains":
                        where_clauses.append(f'"{col}" LIKE ?')
                        params.append(f"%{val}%")
                    elif op == "equals":
                        where_clauses.append(f'"{col}" = ?')
                        params.append(val)
                    elif op == "starts_with":
                        where_clauses.append(f'"{col}" LIKE ?')
                        params.append(f"{val}%")
                    elif op == "ends_with":
                        where_clauses.append(f'"{col}" LIKE ?')
                        params.append(f"%{val}")
                    elif op == "greater_than":
                        where_clauses.append(f'"{col}" > ?')
                        params.append(val)
                    elif op == "less_than":
                        where_clauses.append(f'"{col}" < ?')
                        params.append(val)
                    elif op == "not_equal":
                        where_clauses.append(f'"{col}" != ?')
                        params.append(val)

            if where_clauses:
                where_sql = " WHERE " + " AND ".join(where_clauses)
                count_query += where_sql
                base_query += where_sql

            if self.db_type == "sqlite":
                cur = self.connection.cursor()
                cur.execute(count_query, params)
                total_rows = cur.fetchone()["cnt"]
            else:
                # DuckDB: ? placeholders work for WHERE but not LIMIT/OFFSET
                cur = self.connection.execute(count_query, params or [])
                total_rows = cur.fetchone()[0]

            if sort_by:
                base_query += f' ORDER BY "{sort_by}" {sort_dir}'

            offset = (page - 1) * per_page
            # Format LIMIT/OFFSET directly (not parameterized - integers only, safe)
            base_query += f" LIMIT {per_page} OFFSET {offset}"

            if self.db_type == "sqlite":
                cur = self.connection.cursor()
                cur.execute(base_query, params)
                rows = [dict(row) for row in cur.fetchall()]
                cols = self.get_table_schema(table_name)
                column_names = [c["name"] for c in cols]
            else:
                cur = self.connection.execute(base_query, params or [])
                column_names = [desc[0] for desc in cur.description] if cur.description else []
                fetched = cur.fetchall()
                rows = [dict(zip(column_names, row)) for row in fetched]

            return {
                "columns": column_names,
                "rows": rows,
                "total": total_rows,
                "page": page,
                "per_page": per_page,
                "total_pages": max(1, (total_rows + per_page - 1) // per_page),
            }

    def execute_sql(self, sql):
        """Execute an arbitrary SQL statement and return results."""
        with self._lock:
            if not self.is_connected():
                raise RuntimeError("No database connected")
            sql = sql.strip().rstrip(";")
            cur = self.connection.cursor()
            cur.execute(sql)

            is_query = sql.upper().startswith(
                ("SELECT", "PRAGMA", "EXPLAIN", "DESCRIBE", "SHOW")
            )

            if is_query:
                columns = [desc[0] for desc in cur.description] if cur.description else []
                if self.db_type == "sqlite":
                    rows = [dict(row) for row in cur.fetchall()]
                else:
                    fetched = cur.fetchall()
                    rows = [dict(zip(columns, row)) for row in fetched]
                return {"type": "query", "columns": columns, "rows": rows}
            else:
                if self.db_type == "sqlite":
                    self.connection.commit()
                else:
                    try:
                        self.connection.commit()
                    except AttributeError:
                        pass
                affected = cur.rowcount if hasattr(cur, "rowcount") and cur.rowcount >= 0 else 0
                return {"type": "exec", "affected": affected}


# Global instance
db_manager = DatabaseManager()
