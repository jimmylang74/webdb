#!/usr/bin/env python3
"""Database Explorer - Web-based SQLite database browser with file manager.

Usage:
    python db.py                        # Run on default port 8888
    python db.py --port 99999           # Run on custom port
    python db.py --port 8888 --host 0.0.0.0  # Listen on all interfaces
"""

import argparse
import logging
import sys
import os

from flask import Flask, jsonify, request, render_template, session

try:
    from waitress import serve as wsgi_serve
    HAS_WAITRESS = True
except ImportError:
    HAS_WAITRESS = False

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from modules.filesystem import list_directory, get_parent_dir
from modules.session import session_manager

app = Flask(__name__, static_folder="web/static", template_folder="web/templates")
app.secret_key = os.urandom(32).hex()  # Per-run random key for signed cookies

# Logging configuration
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.FileHandler("out.log"),
        logging.StreamHandler(sys.stderr),
    ],
)
logger = logging.getLogger(__name__)


def get_ctx():
    """Get the UserContext for the current request's session.

    Each browser tab gets a unique Flask session cookie → unique session ID →
    isolated shell CWD + isolated database connection.

    We store our own ``session_id`` in the Flask session dict because
    ``session.sid`` is not available on all Flask versions. The Flask session
    itself is a signed cookie, so the session_id survives restarts (but the
    in-memory UserContext does not — that's fine, it gets recreated).
    """
    if "session_id" not in session:
        session["session_id"] = os.urandom(16).hex()
    return session_manager.get(session["session_id"])


# ─── File System Routes ────────────────────────────────────────────────

@app.route("/api/files", methods=["GET"])
def api_list_files():
    """List directory contents."""
    ctx = get_ctx()
    path = request.args.get("path", ctx.shell.cwd)
    if path != ctx.shell.cwd:
        ctx.shell.cwd = path  # sync: tree navigation updates shell CWD
    try:
        result = list_directory(path)
        return jsonify({"ok": True, "data": result})
    except NotADirectoryError:
        return jsonify({"ok": False, "error": f"Not a directory: {path}"}), 400
    except Exception as e:
        logger.exception("Error listing directory")
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/files/parent", methods=["GET"])
def api_parent_dir():
    """Get parent directory of a path."""
    ctx = get_ctx()
    path = request.args.get("path", ctx.shell.cwd)
    parent = get_parent_dir(path)
    return jsonify({"ok": True, "data": {"path": parent}})


# ─── Database Routes ───────────────────────────────────────────────────

@app.route("/api/db/connect", methods=["POST"])
def api_db_connect():
    """Connect to a SQLite database file."""
    ctx = get_ctx()
    data = request.get_json() or {}
    db_path = data.get("path", "")
    if not db_path:
        return jsonify({"ok": False, "error": "No path provided"}), 400
    try:
        result = ctx.db.connect(db_path)
        ctx.shell.cwd = os.path.dirname(os.path.abspath(db_path))
        return jsonify({"ok": True, "data": result})
    except FileNotFoundError as e:
        return jsonify({"ok": False, "error": str(e)}), 404
    except Exception as e:
        logger.exception("Error connecting to database")
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/db/disconnect", methods=["POST"])
def api_db_disconnect():
    """Disconnect the current database."""
    ctx = get_ctx()
    ctx.db.disconnect()
    return jsonify({"ok": True, "data": {"status": "disconnected"}})


@app.route("/api/db/status", methods=["GET"])
def api_db_status():
    """Get current database connection status."""
    ctx = get_ctx()
    if ctx.db.is_connected():
        return jsonify({
            "ok": True,
            "data": {
                "connected": True,
                "db_path": ctx.db.db_path,
                "db_type": ctx.db.db_type,
            }
        })
    return jsonify({
        "ok": True,
        "data": {
            "connected": False,
            "db_path": None,
            "db_type": None,
        }
    })


@app.route("/api/db/tables", methods=["GET"])
def api_db_tables():
    """List all tables in the connected database."""
    ctx = get_ctx()
    try:
        tables = ctx.db.get_tables()
        return jsonify({"ok": True, "data": {"tables": tables}})
    except RuntimeError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/db/schema/<table_name>", methods=["GET"])
def api_db_schema(table_name):
    """Get schema for a specific table."""
    ctx = get_ctx()
    try:
        schema = ctx.db.get_table_schema(table_name)
        return jsonify({"ok": True, "data": {"schema": schema}})
    except RuntimeError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/db/rows/<table_name>", methods=["GET"])
def api_db_rows(table_name):
    """Get rows from a table with sorting, filtering, and pagination."""
    ctx = get_ctx()
    sort_by = request.args.get("sort_by")
    sort_dir = request.args.get("sort_dir", "asc")
    page = int(request.args.get("page", 1))
    per_page = int(request.args.get("per_page", 100))

    filters = []
    filter_cols = request.args.getlist("filter_column")
    filter_ops = request.args.getlist("filter_op")
    filter_vals = request.args.getlist("filter_value")
    for i, col in enumerate(filter_cols):
        op = filter_ops[i] if i < len(filter_ops) else "contains"
        val = filter_vals[i] if i < len(filter_vals) else ""
        filters.append({"column": col, "operator": op, "value": val})

    try:
        result = ctx.db.get_table_rows(
            table_name,
            sort_by=sort_by,
            sort_dir=sort_dir,
            filters=filters if any(f["value"] for f in filters) else None,
            page=page,
            per_page=per_page,
        )
        return jsonify({"ok": True, "data": result})
    except RuntimeError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


# ─── Shell Route ───────────────────────────────────────────────────────

@app.route("/api/shell/exec", methods=["POST"])
def api_shell_exec():
    """Execute a shell command or SQL query."""
    ctx = get_ctx()
    data = request.get_json() or {}
    command = data.get("command", "")
    if not command:
        return jsonify({"ok": True, "data": {"output": "", "cwd": ctx.shell.cwd}})
    try:
        # Pass the session's db_manager so SQL commands route to this
        # session's database connection.
        output = ctx.shell.execute(command, db_manager=ctx.db)
        return jsonify({
            "ok": True,
            "data": {
                "output": output,
                "cwd": ctx.shell.cwd,
            }
        })
    except Exception as e:
        logger.exception("Error executing shell command")
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/shell/cwd", methods=["GET"])
def api_shell_cwd():
    """Get current working directory."""
    ctx = get_ctx()
    return jsonify({"ok": True, "data": {"cwd": ctx.shell.cwd}})


# ─── Main Page Route ────────────────────────────────────────────────────

@app.route("/")
def index():
    """Serve the main application page."""
    return render_template("index.html")


# ─── Entry Point ───────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Database Explorer Web UI")
    parser.add_argument("--host", default="0.0.0.0", help="Host to bind to (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=8888, help="Port to listen on (default: 8888)")
    parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    parser.add_argument("--no-waitress", action="store_true", help="Use Flask dev server instead of waitress")
    args = parser.parse_args()

    logger.info("Starting Database Explorer on http://%s:%d", args.host, args.port)

    if HAS_WAITRESS and not args.no_waitress and not args.debug:
        logger.info("Using waitress WSGI server")
        wsgi_serve(app, host=args.host, port=args.port)
    else:
        app.run(
            host=args.host,
            port=args.port,
            debug=args.debug,
            use_reloader=False,
        )


if __name__ == "__main__":
    main()
