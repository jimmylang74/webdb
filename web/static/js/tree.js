/**
 * Tree Component - File explorer and database structure tree.
 *
 * Renders a collapsible tree with:
 * - Directory listing for file navigation
 * - SQLite database structure when connected (tables → columns)
 * - Right-click context menu on SQLite files for "Connect"
 */
class FileTree {
    constructor(containerEl, options = {}) {
        this.el = containerEl;
        this.onConnectDb = options.onConnectDb || (() => {});
        this.onDisconnectDb = options.onDisconnectDb || (() => {});
        this.onSelectTable = options.onSelectTable || (() => {});
        this.currentPath = options.initialPath || '/';
        this.dbConnected = false;
        this.treeData = null;
        this.selectedNode = null;
        this.contextMenu = document.getElementById('context-menu');
        this.contextMenuItems = document.getElementById('context-menu-items');

        // Bind context menu handlers
        this._bindContextMenu();
    }

    _bindContextMenu() {
        document.addEventListener('click', () => {
            this.contextMenu.classList.add('hidden');
        });
        document.addEventListener('contextmenu', (e) => {
            if (!e.target.closest('.tree-node-content')) {
                this.contextMenu.classList.add('hidden');
            }
        });
    }

    async loadDirectory(path) {
        this.currentPath = path;
        try {
            const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`);
            const json = await res.json();
            if (!json.ok) throw new Error(json.error);
            this.treeData = json.data;
            this.dbConnected = false;
            this.render();
        } catch (err) {
            console.error('Failed to load directory:', err);
        }
    }

    async loadParentDir() {
        try {
            const res = await fetch(`/api/files/parent?path=${encodeURIComponent(this.currentPath)}`);
            const json = await res.json();
            if (json.ok) {
                await this.loadDirectory(json.data.path);
            }
        } catch (err) {
            console.error('Failed to load parent dir:', err);
        }
    }

    setDatabaseTree(dbPath, tables) {
        this.dbConnected = true;
        this.treeData = {
            path: dbPath,
            entries: [],
            dbTree: true,
            dbPath: dbPath,
            tables: tables,
        };
        this.render();
    }

    clearDatabaseTree() {
        this.dbConnected = false;
        if (this.treeData && this.treeData.dbTree) {
            this.treeData = null;
            this.render();
        }
    }

    render() {
        this.el.innerHTML = '';
        this.selectedNode = null;

        if (!this.treeData) {
            this.el.innerHTML = '<div class="placeholder-msg" style="padding:20px;text-align:center;color:var(--text-muted)">Loading...</div>';
            return;
        }

        const rootList = document.createElement('ul');
        rootList.className = 'tree-root';

        if (this.dbConnected && this.treeData.dbTree) {
            this._renderDbTree(rootList, this.treeData);
        } else {
            this._renderDirTree(rootList, this.treeData);
        }

        this.el.appendChild(rootList);
    }

    _renderDirTree(parentList, data) {
        const path = data.path;

        // Parent directory entry
        const parentItem = document.createElement('li');
        parentItem.className = 'tree-node';
        const parentContent = document.createElement('div');
        parentContent.className = 'tree-node-content';
        parentContent.style.setProperty('--depth', 0);
        parentContent.innerHTML = `
            <span class="tree-expander placeholder">&#x25B6;</span>
            <span class="tree-icon">&#x1F4C1;</span>
            <span class="tree-label">.. (parent)</span>
        `;
        parentContent.addEventListener('click', () => this.loadParentDir());
        parentItem.appendChild(parentContent);
        parentList.appendChild(parentItem);

        // Directory entries
        for (const entry of data.entries) {
            const item = document.createElement('li');
            item.className = 'tree-node';
            const content = document.createElement('div');
            content.className = 'tree-node-content';
            content.style.setProperty('--depth', 1);
            content.dataset.path = entry.path;
            content.dataset.name = entry.name;
            content.dataset.isDir = entry.is_dir;
            content.dataset.isSqlite = entry.is_sqlite;

            const icon = entry.is_dir ? '&#x1F4C1;' : '&#x1F4C4;';
            const labelClass = entry.is_sqlite ? 'tree-label sqlite-file' : 'tree-label';
            const sizeBadge = !entry.is_dir ? `<span class="tree-type-badge">${entry.size_str}</span>` : '';

            content.innerHTML = `
                <span class="tree-expander placeholder">&#x25B6;</span>
                <span class="tree-icon">${icon}</span>
                <span class="${labelClass}">${this._escapeHtml(entry.name)}</span>
                ${sizeBadge}
            `;

            if (entry.is_dir) {
                content.addEventListener('click', () => this.loadDirectory(entry.path));
            } else if (entry.is_sqlite) {
                // Right-click for SQLite files
                content.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._showContextMenu(e.clientX, e.clientY, entry);
                });
                // Double-click to connect
                content.addEventListener('dblclick', () => {
                    this.onConnectDb(entry.path);
                });
            }

            item.appendChild(content);
            parentList.appendChild(item);
        }
    }

    async _renderDbTree(parentList, data) {
        const dbPath = data.dbPath;
        const dbName = dbPath.split('/').pop() || dbPath;

        // Root: database file node
        const rootItem = document.createElement('li');
        rootItem.className = 'tree-node';
        const rootContent = document.createElement('div');
        rootContent.className = 'tree-node-content';
        rootContent.style.setProperty('--depth', 0);
        rootContent.innerHTML = `
            <span class="tree-expander expanded">&#x25B6;</span>
            <span class="tree-icon">&#x1F5C4;</span>
            <span class="tree-label sqlite-file">${this._escapeHtml(dbName)}</span>
        `;
        rootContent.addEventListener('click', () => {
            const childrenList = rootItem.querySelector('.tree-children');
            const expander = rootContent.querySelector('.tree-expander');
            if (childrenList) {
                const isExpanded = childrenList.classList.toggle('expanded');
                expander.classList.toggle('expanded', isExpanded);
            }
        });
        // Right-click on database root node: show "Disconnect" context menu
        rootContent.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.contextMenuItems.innerHTML = '';
            const item = document.createElement('li');
            item.textContent = 'Disconnect';
            item.addEventListener('click', () => {
                this.contextMenu.classList.add('hidden');
                this.onDisconnectDb();
            });
            this.contextMenuItems.appendChild(item);
            this.contextMenu.style.left = e.clientX + 'px';
            this.contextMenu.style.top = e.clientY + 'px';
            this.contextMenu.classList.remove('hidden');
        });
        rootItem.appendChild(rootContent);

        // Children: tables
        const childrenList = document.createElement('ul');
        childrenList.className = 'tree-children expanded';

        const tables = data.tables || [];
        for (const tableName of tables) {
            const tableItem = document.createElement('li');
            tableItem.className = 'tree-node';
            const tableContent = document.createElement('div');
            tableContent.className = 'tree-node-content';
            tableContent.style.setProperty('--depth', 1);
            tableContent.dataset.table = tableName;

            tableContent.innerHTML = `
                <span class="tree-expander">&#x25B6;</span>
                <span class="tree-icon">&#x1F4CA;</span>
                <span class="tree-label">${this._escapeHtml(tableName)}</span>
            `;

            // Click on table: select it, fetch schema, and load rows
            tableContent.addEventListener('click', async (e) => {
                e.stopPropagation();
                this._selectNode(tableContent);
                this.onSelectTable(tableName);

                // Toggle schema expansion
                const childrenList = tableItem.querySelector('.tree-children');
                const expander = tableContent.querySelector('.tree-expander');
                if (childrenList) {
                    const isExpanded = childrenList.classList.toggle('expanded');
                    expander.classList.toggle('expanded', isExpanded);
                    // Load schema columns the first time the table is expanded
                    if (isExpanded && childrenList.dataset.loaded === 'false') {
                        await this.loadTableSchema(tableName, childrenList);
                    }
                }
            });

            tableItem.appendChild(tableContent);

            // Schema children (loaded on first expand)
            const schemaList = document.createElement('ul');
            schemaList.className = 'tree-children';
            schemaList.dataset.loaded = 'false';

            tableItem.appendChild(schemaList);
            childrenList.appendChild(tableItem);
        }

        rootItem.appendChild(childrenList);
        parentList.appendChild(rootItem);

        // Store reference for later schema loading
        this._schemaLists = this.el.querySelectorAll('.tree-children[data-loaded="false"]');
    }

    async loadTableSchema(tableName, schemaListEl) {
        if (schemaListEl.dataset.loaded === 'true') return;
        try {
            const res = await fetch(`/api/db/schema/${encodeURIComponent(tableName)}`);
            const json = await res.json();
            if (!json.ok) throw new Error(json.error);

            schemaListEl.innerHTML = '';
            for (const col of json.data.schema) {
                const colItem = document.createElement('li');
                colItem.className = 'tree-node';
                const colContent = document.createElement('div');
                colContent.className = 'tree-node-content';
                colContent.style.setProperty('--depth', 2);
                const pkIcon = col.pk ? '&#x1F511;' : '';
                colContent.innerHTML = `
                    <span class="tree-expander placeholder">&#x25B6;</span>
                    <span class="tree-icon">${pkIcon || '&#x2192;'}</span>
                    <span class="tree-label">${this._escapeHtml(col.name)}</span>
                    <span class="tree-type-badge">${this._escapeHtml(col.type || 'TEXT')}</span>
                `;
                colItem.appendChild(colContent);
                schemaListEl.appendChild(colItem);
            }
            schemaListEl.dataset.loaded = 'true';
        } catch (err) {
            console.error('Failed to load schema:', err);
        }
    }

    _selectNode(nodeEl) {
        if (this.selectedNode) {
            this.selectedNode.classList.remove('selected');
        }
        nodeEl.classList.add('selected');
        this.selectedNode = nodeEl;
    }

    _showContextMenu(x, y, entry) {
        this.contextMenuItems.innerHTML = '';
        if (entry.is_sqlite) {
            const item = document.createElement('li');
            item.textContent = 'Connect';
            item.addEventListener('click', () => {
                this.contextMenu.classList.add('hidden');
                this.onConnectDb(entry.path);
            });
            this.contextMenuItems.appendChild(item);
        }
        this.contextMenu.style.left = x + 'px';
        this.contextMenu.style.top = y + 'px';
        this.contextMenu.classList.remove('hidden');
    }

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}
