"""Shell command execution module with state."""

import os
import subprocess
import logging

logger = logging.getLogger(__name__)


class ShellSession:
    """Stateful shell session with current working directory."""

    def __init__(self, start_dir=None):
        self.cwd = start_dir or os.getcwd()
        self.env = os.environ.copy()

    def execute(self, command, db_manager=None):
        """Execute a shell command and return output.

        Args:
            command: The command string to execute.
            db_manager: Optional DatabaseManager instance. If provided and
                        connected, input is treated as SQL by default.
        """
        if not command or not command.strip():
            return ""

        command = command.strip()

        # When a database is connected, treat input as SQL by default.
        # Shell commands are still available via the "!" prefix or
        # built-in navigation commands (cd, ls, ll, pwd).
        if db_manager and db_manager.is_connected():
            # "!<shell command>" escapes to the shell
            if command.startswith("!"):
                return self._run_command(command[1:].strip())

            # Built-in navigation commands always go to the shell
            if command.startswith("cd "):
                return self._handle_cd(command[3:].strip())
            if command == "cd":
                return self._handle_cd("~")
            if command.startswith("pwd"):
                return self.cwd + "\n"
            if command.startswith("ls") or command.startswith("ll"):
                return self._handle_ls(command)

            # Everything else is SQL
            return self._execute_sql(command, db_manager)

        # No database connected — all input is a shell command.
        # Handle cd separately (subprocess can't change our cwd)
        if command.startswith("cd "):
            return self._handle_cd(command[3:].strip())

        if command == "cd":
            return self._handle_cd("~")

        if command.startswith("pwd"):
            return self.cwd + "\n"

        if command.startswith("ls") or command.startswith("ll"):
            return self._handle_ls(command)

        # General shell command execution
        return self._run_command(command)

    def _looks_like_sql(self, command):
        """Check if a command looks like SQL."""
        sql_keywords = [
            "SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "DROP",
            "ALTER", "PRAGMA", "EXPLAIN", "BEGIN", "COMMIT", "ROLLBACK",
            "WITH", "ATTACH", "DETACH", "VACUUM", "REINDEX", "ANALYZE",
        ]
        upper = command.strip().rstrip(";").strip().upper()
        for kw in sql_keywords:
            if upper.startswith(kw) or upper.startswith(f"EXPLAIN {kw}") or upper.startswith(f"WITH "):
                return True
        return False

    def _handle_cd(self, target):
        """Handle cd command."""
        if not target or target == "~":
            target = os.path.expanduser("~")
        target = os.path.expanduser(target)
        new_dir = os.path.join(self.cwd, target) if not target.startswith("/") else target
        new_dir = os.path.abspath(new_dir)
        if os.path.isdir(new_dir):
            self.cwd = new_dir
            return ""
        else:
            return f"cd: {target}: No such directory\n"

    def _handle_ls(self, command):
        """Handle ls/ll command."""
        parts = command.split()
        show_all = "-a" in parts or "-la" in parts or "-al" in parts
        long_format = command.startswith("ll") or "-l" in parts or "-la" in parts or "-al" in parts

        target_path = self.cwd
        for part in parts[1:]:
            if not part.startswith("-"):
                target_path = os.path.join(self.cwd, part) if not part.startswith("/") else part
                target_path = os.path.abspath(target_path)
                break

        if not os.path.isdir(target_path):
            return f"ls: cannot access '{target_path}': No such directory\n"

        try:
            items = sorted(os.listdir(target_path))
        except PermissionError:
            return f"ls: cannot open directory '{target_path}': Permission denied\n"

        if not show_all:
            items = [i for i in items if not i.startswith(".")]

        if long_format:
            output = []
            for name in items:
                full = os.path.join(target_path, name)
                try:
                    st = os.lstat(full)
                    mode = ""
                    mode += "d" if os.path.isdir(full) else "-"
                    mode += "r" if st.st_mode & 0o400 else "-"
                    mode += "w" if st.st_mode & 0o200 else "-"
                    mode += "x" if st.st_mode & 0o100 else "-"
                    mode += "r" if st.st_mode & 0o040 else "-"
                    mode += "w" if st.st_mode & 0o020 else "-"
                    mode += "x" if st.st_mode & 0o010 else "-"
                    mode += "r" if st.st_mode & 0o004 else "-"
                    mode += "w" if st.st_mode & 0o002 else "-"
                    mode += "x" if st.st_mode & 0o001 else "-"
                    size = st.st_size
                    import time
                    mtime = time.strftime("%b %d %H:%M", time.localtime(st.st_mtime))
                    output.append(f"{mode} {st.st_nlink:>2} {size:>8} {mtime} {name}")
                except OSError:
                    output.append(f"?????????? ? ???????? ???????? ? {name}")
            return "\n".join(output) + "\n"
        else:
            cols = 4
            col_width = max(len(i) for i in items) + 2 if items else 20
            lines = []
            for i in range(0, len(items), cols):
                line = "".join(item.ljust(col_width) for item in items[i:i + cols])
                lines.append(line.rstrip())
            return "\n".join(lines) + "\n"

    MAX_COL_WIDTH = 500  # Cap display width per column to prevent multi-MB output

    @staticmethod
    def _trunc(val, width):
        """Truncate a value to width with ellipsis if needed."""
        s = str(val)
        if len(s) > width:
            return s[:width - 3] + "..." if width > 3 else s[:width]
        return s.ljust(width)

    def _execute_sql(self, command, db_manager):
        """Execute SQL command and format result.

        Returns a dict with ``output`` (formatted string) and optionally
        ``query_result`` (raw ``execute_sql`` result for the DataTable).
        """
        try:
            result = db_manager.execute_sql(command)
            if result["type"] == "query":
                if not result["rows"]:
                    return {"output": "Query returned no rows.\n"}
                cols = result["columns"]
                widths = [min(len(c), self.MAX_COL_WIDTH) for c in cols]
                for row in result["rows"]:
                    for i, col in enumerate(cols):
                        val = str(row.get(col, ""))
                        widths[i] = max(widths[i], min(len(val), self.MAX_COL_WIDTH))

                header = " | ".join(self._trunc(c, w) for c, w in zip(cols, widths))
                sep = "-+-".join("-" * w for w in widths)
                lines = [header, sep]
                for row in result["rows"]:
                    lines.append(" | ".join(self._trunc(row.get(c, ""), w) for c, w in zip(cols, widths)))
                output = "\n".join(lines) + f"\n({len(result['rows'])} rows)\n"
                return {"output": output, "query_result": result}
            else:
                return {"output": f"Query OK, {result['affected']} rows affected.\n"}
        except Exception as e:
            return {"output": f"SQL Error: {e}\n"}

    def _run_command(self, command):
        """Run a general shell command via subprocess."""
        try:
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                cwd=self.cwd,
                env=self.env,
                timeout=30,
            )
            output = ""
            if result.stdout:
                output += result.stdout
            if result.stderr:
                output += result.stderr
            if result.returncode != 0 and not output:
                output += f"Command exited with code {result.returncode}\n"
            return output
        except subprocess.TimeoutExpired:
            return "Command timed out.\n"
        except Exception as e:
            return f"Error: {e}\n"
