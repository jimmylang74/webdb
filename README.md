# Database Explorer

Web-based SQLite browser with file manager, data table viewer, and integrated terminal. Each browser tab gets an isolated shell session and database connection.

![screenshot](https://img.shields.io/badge/stack-Flask%20%2B%20waitress-89b4fa?style=flat-square)
![python](https://img.shields.io/badge/python-3.8%2B-89b4fa?style=flat-square)

## Features

- **File tree** — browse directories, navigate by clicking, auto-detect `.db`/`.sqlite`/`.sqlite3`/`.duckdb`/`.ddb`/`.csv` files
- **Database connection** — right-click or double-click a SQLite, DuckDB, or CSV file to connect; right-click the DB root node or click header button to disconnect
- **Table viewer** — sortable columns, per-column text filters, pagination
- **Built-in terminal** — shell commands (`cd`, `ls`, `pwd`) and SQL queries auto-detected when a database is connected
- **Session isolation** — each browser tab has its own shell CWD and database connection (Flask signed cookies)
- **Resizable panels** — drag vertical divider (file tree ↔ content), drag horizontal divider (table ↔ terminal)
- **Catppuccin dark theme** — Mocha palette

## Quick Start

```bash
pip install flask waitress
python db.py
```

Open http://localhost:8888

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | `8888` | Port to listen on |
| `--host` | `0.0.0.0` | Bind address |
| `--debug` | off | Flask debug mode |
| `--no-waitress` | off | Use Flask dev server instead of waitress |

## Project Structure

```
├── db.py                  # Flask application, routes, entry point
├── modules/
│   ├── database.py        # SQLite connection management
│   ├── filesystem.py      # Directory listing and file detection
│   ├── session.py         # Per-tab session context manager
│   └── shell.py           # Shell command execution with state
└── web/
    ├── templates/
    │   └── index.html     # Single-page application layout
    └── static/
        ├── css/
        │   └── app.css    # Catppuccin theme, layout, components
        └── js/
            ├── app.js     # Main controller, component wiring, resize
            ├── tree.js    # File tree and database tree component
            ├── terminal.js# Terminal emulator with history
            └── datatable.js # Paginated data table with filters
```

## Architecture

### Backend

The Flask server runs on a configurable port (default 8888) using **waitress** for production-grade WSGI serving, falling back to the Flask dev server.

Each HTTP request gets a **UserContext** keyed by a random `session_id` stored in a signed Flask cookie. The context holds:

- `ShellSession` — persistent `cwd` and shell environment per tab
- `DatabaseManager` — per-tab SQLite connection with thread-safe `RLock`

### Frontend

Vanilla JavaScript ES6 classes — no framework. Four components:

1. **FileTree** — directory listing and database tree (tables → columns)
2. **DataTable** — sortable, filterable, paginated table view
3. **Terminal** — shell/SQL command line with history (up/down arrows)
4. **App** — wires components together, manages state, drives panel resizing

### Key behaviors

- Tree navigation syncs the shell's CWD
- `cd` in the terminal updates the file tree (unless a database tree is shown)
- SQL-looking commands (`SELECT`, `INSERT`, etc.) route through the database instead of the shell
- `Ctrl+L` focuses the terminal, `Ctrl+K` clears it
- Right-click `.sqlite` files → **Connect**; right-click connected DB root → **Disconnect**

## Dependencies

- Python 3.8+
- [Flask](https://flask.palletsprojects.com/) — web framework
- [waitress](https://docs.pylonsproject.org/projects/waitress/) — production WSGI server (optional, auto-detected)

No database drivers needed for SQLite — it is in the Python standard library.
[DuckDB](https://duckdb.org/) (`pip install duckdb`) is required for DuckDB (`.duckdb`/`.ddb`) and CSV (`.csv`) file support.

## License

MIT
