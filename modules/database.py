"""SQLite database management module."""

import sqlite3
import os
import logging
import threading

logger = logging.getLogger(__name__)


class DatabaseManager:
    """Manages SQLite database connections and operations.

    Thread-safe: uses a lock to serialize access and check_same_thread=False
    so the connection can be used across waitress worker threads.
    """

    def __init__(self):
        self._lock = threading.RLock()
        self.connection = None
        self.db_path = None

    def _cursor(self):
        """Get a cursor from the current connection."""
        return self.connection.cursor()

    def connect(self, db_path):
        """Connect to a SQLite database file."""
        with self._lock:
            if not os.path.isfile(db_path):
                raise FileNotFoundError(f"Database file not found: {db_path}")
            if self.connection:
                self.disconnect()
            abs_path = os.path.abspath(db_path)
            self.connection = sqlite3.connect(abs_path, check_same_thread=False)
            self.connection.row_factory = sqlite3.Row
            self.db_path = abs_path
            logger.info("Connected to database: %s", abs_path)
            return {"db_path": abs_path, "status": "connected"}

    def disconnect(self):
        """Disconnect the current database."""
        with self._lock:
            if self.connection:
                self.connection.close()
                self.connection = None
                self.db_path = None
                logger.info("Disconnected from database")

    def is_connected(self):
        return self.connection is not None

    def get_tables(self):
        """List all tables in the connected database."""
        with self._lock:
            if not self.is_connected():
                raise RuntimeError("No database connected")
            cur = self._cursor()
            cur.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )
            tables = [row["name"] for row in cur.fetchall()]
            return tables

    def get_table_schema(self, table_name):
        """Get schema (column name and type) for a table."""
        with self._lock:
            if not self.is_connected():
                raise RuntimeError("No database connected")
            cur = self._cursor()
            cur.execute(f'PRAGMA table_info("{table_name}")')
            columns = [
                {"name": row["name"], "type": row["type"], "notnull": bool(row["notnull"]), "pk": bool(row["pk"])}
                for row in cur.fetchall()
            ]
            return columns

    def get_table_rows(self, table_name, sort_by=None, sort_dir="asc", filters=None, page=1, per_page=100):
        """Get rows from a table with optional sorting and filtering."""
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

            cur = self._cursor()
            cur.execute(count_query, params)
            total_rows = cur.fetchone()["cnt"]

            if sort_by:
                base_query += f' ORDER BY "{sort_by}" {sort_dir}'

            offset = (page - 1) * per_page
            base_query += " LIMIT ? OFFSET ?"
            query_params = params + [per_page, offset]

            cur.execute(base_query, query_params)
            rows = [dict(row) for row in cur.fetchall()]

            columns = self.get_table_schema(table_name)
            column_names = [c["name"] for c in columns]

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
            cur = self._cursor()
            cur.execute(sql)
            if sql.upper().startswith(("SELECT", "PRAGMA", "EXPLAIN")):
                columns = [desc[0] for desc in cur.description] if cur.description else []
                rows = [dict(row) for row in cur.fetchall()]
                return {"type": "query", "columns": columns, "rows": rows}
            else:
                self.connection.commit()
                return {"type": "exec", "affected": cur.rowcount}


# Global instance
db_manager = DatabaseManager()
