/**
 * Main Application Controller.
 * Wires together the Tree, DataTable, and Terminal components.
 * Manages database connection state and coordinates between components.
 */
class App {
    constructor() {
        this.dbStatusEl = document.getElementById('db-status');
        this.dbDisconnectBtn = document.getElementById('btn-disconnect-db');
        this.refreshBtn = document.getElementById('btn-refresh-tree');
        this.dbConnected = false;
        this.dbPath = null;
        this.dbType = null;

        // Initialize components
        this.tree = new FileTree(document.getElementById('tree-container'), {
            initialPath: '/',
            onConnectDb: (path) => this.connectDatabase(path),
            onDisconnectDb: () => this.disconnectDatabase(),
            onSelectTable: (tableName) => this.selectTable(tableName),
        });

        this.table = new DataTable(document.getElementById('data-container'));

        this.terminal = new Terminal({
            onCwdChange: (newCwd) => {
                // Sync file tree when terminal cd changes directory
                if (!this.dbConnected) {
                    this.tree.loadDirectory(newCwd);
                }
            },
            onQueryResult: (data) => {
                this.table.showQueryResult(data.columns, data.rows);
            },
        });

        // Bind events
        this.refreshBtn.addEventListener('click', () => this.refreshTree());
        if (this.dbDisconnectBtn) {
            this.dbDisconnectBtn.addEventListener('click', () => this.disconnectDatabase());
        }

        // Keyboard shortcut: Ctrl+L to focus terminal
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'l') {
                e.preventDefault();
                this.terminal.focus();
            }
            if (e.ctrlKey && e.key === 'k') {
                e.preventDefault();
                this.terminal.clear();
            }
        });

        // Check database status on load
        this._checkDbStatus();

        // Load initial directory
        this._loadInitialDir();

        // Initialize panel resize
        this._initResize();

        console.log('App initialized. Ctrl+L to focus terminal, Ctrl+K to clear terminal.');
    }

    async _loadInitialDir() {
        // Start from home directory
        try {
            const res = await fetch('/api/shell/cwd');
            const json = await res.json();
            if (json.ok) {
                await this.tree.loadDirectory(json.data.cwd);
            }
        } catch (err) {
            console.error('Failed to load initial directory:', err);
            await this.tree.loadDirectory('/');
        }
    }

    async _checkDbStatus() {
        try {
            const res = await fetch('/api/db/status');
            const json = await res.json();
            if (json.ok && json.data.connected) {
                this.dbConnected = true;
                this.dbPath = json.data.db_path;
                this.dbType = json.data.db_type;
                this._updateDbStatus();
            }
        } catch (err) {
            console.error('Failed to check DB status:', err);
        }
    }

    async connectDatabase(dbPath) {
        try {
            const res = await fetch('/api/db/connect', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: dbPath }),
            });
            const json = await res.json();

            if (!json.ok) {
                this.terminal._writeError('Connect failed: ' + json.error);
                return;
            }

            this.dbConnected = true;
            this.dbPath = dbPath;
            this.dbType = json.data.db_type;

            // Fetch tables
            const tablesRes = await fetch('/api/db/tables');
            const tablesJson = await tablesRes.json();

            if (tablesJson.ok) {
                this.tree.setDatabaseTree(dbPath, tablesJson.data.tables, this.dbType);
            }

            this._updateDbStatus();
            this.terminal._writeln(`Connected to ${this.dbType.toUpperCase()}: ${dbPath}`);

            // Show tables in terminal
            if (tablesJson.ok) {
                this.terminal._writeln(`Tables: ${tablesJson.data.tables.join(', ')}`);
            }
        } catch (err) {
            this.terminal._writeError('Connection error: ' + err.message);
        }
    }

    async disconnectDatabase() {
        try {
            await fetch('/api/db/disconnect', { method: 'POST' });
            this.dbConnected = false;
            this.dbPath = null;
            this.tree.clearDatabaseTree();
            this.table.showPlaceholder('Database disconnected');
            this._updateDbStatus();
            this.terminal._writeln('Disconnected from database.');
            // Return to file tree browsed to the shell's current directory
            const cwdRes = await fetch('/api/shell/cwd');
            const cwdJson = await cwdRes.json();
            if (cwdJson.ok) {
                await this.tree.loadDirectory(cwdJson.data.cwd);
            }
        } catch (err) {
            console.error('Failed to disconnect:', err);
        }
    }

    async selectTable(tableName) {
        await this.table.loadTable(tableName);
    }

    async refreshTree() {
        if (this.dbConnected && this.tree.dbConnected) {
            // Refresh database tree
            try {
                const tablesRes = await fetch('/api/db/tables');
                const tablesJson = await tablesRes.json();
                if (tablesJson.ok) {
                    this.tree.setDatabaseTree(this.dbPath, tablesJson.data.tables, this.dbType);
                }
            } catch (err) {
                console.error('Failed to refresh DB tree:', err);
            }
        } else {
            await this.tree.loadDirectory(this.tree.currentPath);
        }
    }

    _updateDbStatus() {
        if (this.dbConnected) {
            const name = this.dbPath.split('/').pop();
            const typeStr = this.dbType ? `[${this.dbType.toUpperCase()}] ` : '';
            this.dbStatusEl.textContent = typeStr + name;
            this.dbStatusEl.className = 'db-status connected';
            if (this.dbDisconnectBtn) {
                this.dbDisconnectBtn.classList.remove('hidden');
            }
        } else {
            this.dbStatusEl.textContent = 'Not connected';
            this.dbStatusEl.className = 'db-status disconnected';
            if (this.dbDisconnectBtn) {
                this.dbDisconnectBtn.classList.add('hidden');
            }
        }
    }

    _initResize() {
        // ── Vertical resize (left panel ↔ right content) ──
        const vHandle = document.getElementById('resize-v');
        const leftPanel = document.getElementById('left-panel');
        const rightContent = document.getElementById('right-content');

        if (vHandle && leftPanel && rightContent) {
            vHandle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startLeft = leftPanel.getBoundingClientRect().width;
                const startRight = rightContent.getBoundingClientRect().width;
                document.body.classList.add('resize-dragging');

                const onMove = (ev) => {
                    const dx = ev.clientX - startX;
                    const total = leftPanel.getBoundingClientRect().width + rightContent.getBoundingClientRect().width;
                    let newLeft = startLeft + dx;
                    // Clamp to 150px-600px for left panel
                    newLeft = Math.max(150, Math.min(600, newLeft));
                    newLeft = Math.min(total - 200, newLeft); // right side needs at least 200px
                    const pct = (newLeft / total) * 100;
                    leftPanel.style.flex = `0 0 ${pct}%`;
                    vHandle.classList.add('dragging');
                };

                const onUp = () => {
                    document.body.classList.remove('resize-dragging');
                    vHandle.classList.remove('dragging');
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                };

                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        }

        // ── Horizontal resize (data panel ↔ terminal) ──
        const hHandle = document.getElementById('resize-h');
        const dataPanel = document.getElementById('data-panel');
        const termPanel = document.getElementById('terminal-panel');

        if (hHandle && dataPanel && termPanel) {
            hHandle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const startY = e.clientY;
                const startTop = dataPanel.getBoundingClientRect().height;
                const startBot = termPanel.getBoundingClientRect().height;
                document.body.classList.add('resize-dragging', 'resize-dragging-h');

                const onMove = (ev) => {
                    const dy = ev.clientY - startY;
                    const total = dataPanel.getBoundingClientRect().height + termPanel.getBoundingClientRect().height;
                    let newTop = startTop + dy;
                    // Clamp data panel 100px-80% of total; terminal at least 80px
                    newTop = Math.max(100, Math.min(total * 0.8, newTop));
                    newTop = Math.min(total - 80, newTop);
                    const pct = (newTop / total) * 100;
                    dataPanel.style.flex = `0 0 ${pct}%`;
                    hHandle.classList.add('dragging');
                };

                const onUp = () => {
                    document.body.classList.remove('resize-dragging', 'resize-dragging-h');
                    hHandle.classList.remove('dragging');
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                };

                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        }
    }
}

// Start the application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
});
