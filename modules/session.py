"""Per-session context management.

Each browser tab/window gets its own UserContext with:
- An independent shell session (CWD, env)
- An independent database connection
"""

import threading
import logging

logger = logging.getLogger(__name__)


class UserContext:
    """Holds all per-session state for one browser tab."""

    def __init__(self):
        from modules.shell import ShellSession
        from modules.database import DatabaseManager

        self.shell = ShellSession()
        self.db = DatabaseManager()

    def cleanup(self):
        """Release resources (close DB connection)."""
        try:
            self.db.disconnect()
        except Exception:
            pass


class SessionManager:
    """Thread-safe manager for per-session contexts.

    Contexts are keyed by Flask session ID (from signed cookie).
    Never cleaned up automatically — the dict grows with unique visitors,
    which is acceptable for a local dev tool.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._sessions = {}

    def get(self, session_id):
        """Get or create a UserContext for the given session_id."""
        with self._lock:
            if session_id not in self._sessions:
                self._sessions[session_id] = UserContext()
                logger.info("Created new session context: %s", session_id)
            return self._sessions[session_id]

    def remove(self, session_id):
        """Remove and clean up a session context."""
        with self._lock:
            ctx = self._sessions.pop(session_id, None)
            if ctx:
                ctx.cleanup()
                logger.info("Removed session context: %s", session_id)


# Global singleton
session_manager = SessionManager()
