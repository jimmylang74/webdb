/**
 * Terminal Component - Command line interface for shell and SQL commands.
 *
 * Supports:
 * - Shell commands (cd, ls, ll, pwd, etc.)
 * - SQL queries when a database is connected
 * - Command history (up/down arrow keys)
 * - Output display with auto-scroll
 */
class Terminal {
    constructor(options = {}) {
        this.outputEl = document.getElementById('terminal-output');
        this.inputEl = document.getElementById('terminal-input');
        this.cwdEl = document.getElementById('terminal-cwd');
        this.history = [];
        this.historyIndex = -1;
        this.lines = [];
        this.onCwdChange = options.onCwdChange || (() => {});

        // Welcome message
        this._writeln('Database Explorer Terminal v1.0');
        this._writeln('Type shell commands (cd, ls, ll, pwd) or SQL queries when connected to a database.');
        this._writeln('');

        // Event handlers
        this.inputEl.addEventListener('keydown', (e) => this._onKeyDown(e));

        // Focus input when clicking on terminal
        this.outputEl.addEventListener('click', () => this.inputEl.focus());

        // Load initial CWD
        this._loadCwd();
    }

    focus() {
        this.inputEl.focus();
    }

    async _loadCwd() {
        try {
            const res = await fetch('/api/shell/cwd');
            const json = await res.json();
            if (json.ok) {
                this.cwdEl.textContent = json.data.cwd;
            }
        } catch (err) {
            console.error('Failed to load CWD:', err);
        }
    }

    _onKeyDown(e) {
        if (e.key === 'Enter') {
            const cmd = this.inputEl.value.trim();
            this.inputEl.value = '';
            if (cmd) {
                this._execute(cmd);
            }
            this.historyIndex = -1;
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (this.history.length === 0) return;
            this.historyIndex = Math.max(0, this.historyIndex === -1 ? this.history.length - 1 : this.historyIndex - 1);
            this.inputEl.value = this.history[this.historyIndex];
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (this.history.length === 0) return;
            if (this.historyIndex === -1) return;
            this.historyIndex++;
            if (this.historyIndex >= this.history.length) {
                this.historyIndex = -1;
                this.inputEl.value = '';
            } else {
                this.inputEl.value = this.history[this.historyIndex];
            }
        }
    }

    async _execute(cmd) {
        this.history.push(cmd);

        // Show prompt + command
        this._write(`<span style="color:var(--green)">$</span> `);
        this._writeln(this._escapeHtml(cmd));

        try {
            const res = await fetch('/api/shell/exec', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: cmd }),
            });
            const json = await res.json();

            if (json.ok) {
                if (json.data.output) {
                    this._writeln(json.data.output);
                }
                if (json.data.cwd) {
                    const prev = this.cwdEl.textContent;
                    this.cwdEl.textContent = json.data.cwd;
                    if (prev !== json.data.cwd) {
                        this.onCwdChange(json.data.cwd);
                    }
                }
            } else {
                this._writeError(json.error || 'Command failed');
            }
        } catch (err) {
            this._writeError('Network error: ' + err.message);
        }

        this._scrollToBottom();
    }

    _write(html) {
        const line = document.createElement('div');
        line.className = 'output-line';
        line.innerHTML = html;
        this.outputEl.appendChild(line);
    }

    _writeln(text) {
        const line = document.createElement('div');
        line.className = 'output-line';
        line.textContent = text;
        this.outputEl.appendChild(line);
    }

    _writeError(msg) {
        const line = document.createElement('div');
        line.className = 'output-error';
        line.textContent = msg;
        this.outputEl.appendChild(line);
    }

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    _scrollToBottom() {
        this.outputEl.scrollTop = this.outputEl.scrollHeight;
    }

    clear() {
        this.outputEl.innerHTML = '';
    }
}
