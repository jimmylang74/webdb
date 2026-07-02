"""File system operations module."""

import os
import stat
import pwd
import grp
import time
import logging

logger = logging.getLogger(__name__)


def format_size(size):
    """Format file size in human-readable format."""
    for unit in ("B", "K", "M", "G", "T"):
        if size < 1024:
            return f"{size:.1f}{unit}" if unit != "B" else f"{size}B"
        size /= 1024
    return f"{size:.1f}P"


def format_mode(mode):
    """Format file mode like ls -l."""
    perms = ""
    perms += "d" if stat.S_ISDIR(mode) else "-"
    perms += "r" if mode & stat.S_IRUSR else "-"
    perms += "w" if mode & stat.S_IWUSR else "-"
    perms += "x" if mode & stat.S_IXUSR else "-"
    perms += "r" if mode & stat.S_IRGRP else "-"
    perms += "w" if mode & stat.S_IWGRP else "-"
    perms += "x" if mode & stat.S_IXGRP else "-"
    perms += "r" if mode & stat.S_IROTH else "-"
    perms += "w" if mode & stat.S_IWOTH else "-"
    perms += "x" if mode & stat.S_IXOTH else "-"
    return perms


def list_directory(path="."):
    """List contents of a directory with file info."""
    abs_path = os.path.abspath(path)
    if not os.path.isdir(abs_path):
        raise NotADirectoryError(f"Not a directory: {abs_path}")

    entries = []
    try:
        names = sorted(os.listdir(abs_path))
    except PermissionError:
        return {"path": abs_path, "entries": [], "error": "Permission denied"}

    for name in names:
        full_path = os.path.join(abs_path, name)
        try:
            st = os.lstat(full_path)
            is_dir = os.path.isdir(full_path)
            is_symlink = os.path.islink(full_path)
            entry = {
                "name": name,
                "path": full_path,
                "is_dir": is_dir,
                "is_symlink": is_symlink,
                "is_sqlite": False,
                "size": st.st_size,
                "size_str": format_size(st.st_size),
                "mode": format_mode(st.st_mode),
                "modified": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(st.st_mtime)),
                "permissions": oct(st.st_mode)[-3:],
            }
            # Detect SQLite files by extension
            if not is_dir and name.lower().endswith(".db") or name.lower().endswith(".sqlite") or name.lower().endswith(".sqlite3"):
                entry["is_sqlite"] = True
            # Quick SQLite magic byte check for files without standard extension
            if not is_dir and not entry["is_sqlite"] and st.st_size >= 16:
                try:
                    with open(full_path, "rb") as f:
                        header = f.read(16)
                    if header == b"SQLite format 3\0":
                        entry["is_sqlite"] = True
                        entry["is_sqlite_detected"] = True
                except Exception:
                    pass
            entries.append(entry)
        except OSError:
            continue

    return {"path": abs_path, "entries": entries}


def get_parent_dir(path):
    """Get parent directory path."""
    return os.path.dirname(os.path.abspath(path))


def resolve_path(path, current_dir):
    """Resolve a path relative to current directory."""
    if path.startswith("/"):
        return os.path.abspath(path)
    return os.path.abspath(os.path.join(current_dir, path))
