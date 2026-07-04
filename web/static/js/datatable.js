/**
 * DataTable Component - Displays database query results with sorting, filtering,
 * inline editing, and right-click context menu for Add/Delete rows.
 *
 * Features:
 * - Column-based sorting (click header to sort asc/desc/none)
 * - Column-based filtering (input fields in filter row)
 * - Pagination support
 * - Null value display
 * - Right-click context menu: Add row, Delete row
 * - Double-click cell to edit, blur/Enter to save
 */
class DataTable {
    constructor(containerEl, options = {}) {
        this.container = containerEl;
        this.tableTitle = document.getElementById('table-title');
        this.filterInput = document.getElementById('filter-input');
        this.btnFilter = document.getElementById('btn-filter');
        this.btnClearFilter = document.getElementById('btn-clear-filter');
        this.tableControls = document.getElementById('table-controls');
        this.pagination = document.getElementById('pagination');
        this.pagePrev = document.getElementById('page-prev');
        this.pageNext = document.getElementById('page-next');
        this.pageInfo = document.getElementById('page-info');
        this.contextMenu = document.getElementById('context-menu');
        this.contextMenuItems = document.getElementById('context-menu-items');

        this.currentTable = null;
        this.currentSortBy = null;
        this.currentSortDir = 'asc';
        this.currentPage = 1;
        this.perPage = 100;
        this.totalPages = 1;
        this.totalRows = 0;
        this.columnFilters = {};
        this.primaryKey = null;    // Name of the primary key column
        this.schema = [];           // Column schema info
        this.columns = [];          // Current column list

        // Editing state
        this._editCell = null;      // {td, col, pkValue, pkCol, originalValue}
        this._contextRow = null;    // The <tr> that was right-clicked

        // Bind events
        this.btnFilter.addEventListener('click', () => this._applyGlobalFilter());
        this.btnClearFilter.addEventListener('click', () => this._clearFilters());
        this.filterInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this._applyGlobalFilter();
        });
        this.pagePrev.addEventListener('click', () => {
            if (this.currentPage > 1) {
                this.currentPage--;
                this._loadData();
            }
        });
        this.pageNext.addEventListener('click', () => {
            if (this.currentPage < this.totalPages) {
                this.currentPage++;
                this._loadData();
            }
        });

        // Global click to close context menu and cancel editing
        document.addEventListener('click', (e) => {
            this._hideContextMenu();
        });
    }

    async loadTable(tableName) {
        // Cancel any active edit
        this._cancelEdit();
        this.currentTable = tableName;
        this.currentSortBy = null;
        this.currentSortDir = 'asc';
        this.currentPage = 1;
        this.columnFilters = {};
        this.filterInput.value = '';
        this.tableTitle.textContent = `Table: ${tableName}`;
        this.tableControls.classList.remove('hidden');
        await this._loadData();
    }

    async _loadData() {
        const params = new URLSearchParams();
        params.set('page', this.currentPage);
        params.set('per_page', this.perPage);

        if (this.currentSortBy) {
            params.set('sort_by', this.currentSortBy);
            params.set('sort_dir', this.currentSortDir);
        }

        for (const [col, val] of Object.entries(this.columnFilters)) {
            if (val) {
                params.append('filter_column', col);
                params.append('filter_op', 'contains');
                params.append('filter_value', val);
            }
        }

        try {
            const res = await fetch(`/api/db/rows/${encodeURIComponent(this.currentTable)}?${params}`);
            const json = await res.json();
            if (!json.ok) throw new Error(json.error);
            this.primaryKey = json.data.primary_key || null;
            this.schema = json.data.schema || [];
            this.columns = json.data.columns || [];
            this._render(json.data);
        } catch (err) {
            this.container.innerHTML = `<div class="placeholder-msg" style="color:var(--red)">Error: ${this._escapeHtml(err.message)}</div>`;
        }
    }

    // ─── Render ─────────────────────────────────────────────────

    _render(data) {
        this.totalRows = data.total;
        this.totalPages = data.total_pages;

        if (data.rows.length === 0) {
            this.container.innerHTML = '<div class="placeholder-msg">No rows found</div>';
            this._updatePagination();
            return;
        }

        const cols = data.columns;

        const table = document.createElement('table');
        table.className = 'data-table';

        // ── thead ──
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');

        for (const col of cols) {
            const th = document.createElement('th');
            th.textContent = col;

            const sortIcon = document.createElement('span');
            sortIcon.className = 'sort-icon';
            if (this.currentSortBy === col) {
                sortIcon.textContent = this.currentSortDir === 'asc' ? ' \u25B2' : ' \u25BC';
                sortIcon.classList.add('active');
            } else {
                sortIcon.textContent = ' \u25B2';
            }
            th.appendChild(sortIcon);

            th.addEventListener('click', () => this._toggleSort(col));
            headerRow.appendChild(th);
        }
        thead.appendChild(headerRow);

        // Filter row
        const filterRow = document.createElement('tr');
        filterRow.className = 'filter-row';
        for (const col of cols) {
            const td = document.createElement('td');
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = 'Filter...';
            input.value = this.columnFilters[col] || '';
            input.addEventListener('input', (e) => {
                this.columnFilters[col] = e.target.value;
            });
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.currentPage = 1;
                    this._loadData();
                }
            });
            td.appendChild(input);
            filterRow.appendChild(td);
        }
        thead.appendChild(filterRow);
        table.appendChild(thead);

        // ── tbody ──
        const pkCol = this.primaryKey;
        const tbody = document.createElement('tbody');

        for (const row of data.rows) {
            const tr = document.createElement('tr');
            // Store PK value on the row element
            const pkValue = pkCol ? row[pkCol] : null;
            if (pkValue !== null && pkValue !== undefined) {
                tr.dataset.pk = String(pkValue);
            }

            for (const col of cols) {
                const td = document.createElement('td');
                td.dataset.col = col;
                const val = row[col];
                if (val === null || val === undefined) {
                    td.textContent = 'NULL';
                    td.className = 'null-value';
                } else {
                    td.textContent = String(val);
                    td.title = String(val);
                }
                // Double-click to edit
                td.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    this._startCellEdit(td, col, pkValue, pkCol);
                });
                tr.appendChild(td);
            }

            // Right-click on row for context menu
            tr.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this._contextRow = tr;
                this._showTableContextMenu(e.clientX, e.clientY, pkValue, pkCol);
            });

            tbody.appendChild(tr);
        }
        table.appendChild(tbody);

        this.container.innerHTML = '';
        this.container.appendChild(table);
        this._updatePagination();
    }

    // ─── Inline Cell Editing ─────────────────────────────────────

    _startCellEdit(td, col, pkValue, pkCol) {
        // Cancel any in-progress edit
        this._cancelEdit();

        const currentValue = td.textContent === 'NULL' ? '' : td.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'cell-editor';
        input.value = currentValue;
        td.textContent = '';
        td.appendChild(input);
        td.classList.add('editing');

        this._editCell = { td, col, pkValue, pkCol, originalValue: currentValue };

        // Focus the input
        input.focus();
        input.select();

        // Save on Enter
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                this._cancelEdit();
            }
        });

        // Save on blur (focus lost)
        input.addEventListener('blur', () => {
            this._saveCellEdit();
        });
    }

    async _saveCellEdit() {
        const edit = this._editCell;
        if (!edit) return;

        const { td, col, pkValue, pkCol, originalValue } = edit;
        const input = td.querySelector('input.cell-editor');
        const newValue = input ? input.value.trim() : originalValue;

        this._editCell = null;
        td.classList.remove('editing');

        // If value unchanged, just restore display
        if (newValue === originalValue) {
            this._setCellDisplayValue(td, col, originalValue);
            return;
        }

        // If no PK (query result view), can't save
        if (!pkCol || pkValue === null || pkValue === undefined) {
            this._setCellDisplayValue(td, col, originalValue);
            return;
        }

        // Save to backend
        try {
            const res = await fetch(`/api/db/rows/${encodeURIComponent(this.currentTable)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pk_column: pkCol,
                    pk_value: pkValue,
                    data: { [col]: newValue },
                }),
            });
            const json = await res.json();
            if (!json.ok) throw new Error(json.error);
            this._setCellDisplayValue(td, col, newValue);
        } catch (err) {
            this._setCellDisplayValue(td, col, originalValue);
        }
    }

    _cancelEdit() {
        if (!this._editCell) return;
        const { td, col, originalValue } = this._editCell;
        this._editCell = null;
        td.classList.remove('editing');
        this._setCellDisplayValue(td, col, originalValue);
    }

    _setCellDisplayValue(td, col, value) {
        td.innerHTML = '';
        if (value === null || value === undefined || value === '') {
            td.textContent = 'NULL';
            td.className = 'null-value';
        } else {
            td.textContent = String(value);
            td.title = String(value);
            td.className = '';
        }
    }

    // ─── Context Menu ────────────────────────────────────────────

    _showTableContextMenu(x, y, pkValue, pkCol) {
        this.contextMenuItems.innerHTML = '';

        // Add option
        const addItem = document.createElement('li');
        addItem.textContent = 'Add';
        addItem.addEventListener('click', () => {
            this.contextMenu.classList.add('hidden');
            this._addRow();
        });
        this.contextMenuItems.appendChild(addItem);

        // Delete option (only if we have a PK value — i.e. a real row)
        if (pkValue !== null && pkValue !== undefined && pkCol) {
            const delItem = document.createElement('li');
            delItem.textContent = 'Delete';
            delItem.addEventListener('click', () => {
                this.contextMenu.classList.add('hidden');
                this._deleteRow(pkValue, pkCol);
            });
            this.contextMenuItems.appendChild(delItem);
        }

        this.contextMenu.style.left = x + 'px';
        this.contextMenu.style.top = y + 'px';
        this.contextMenu.classList.remove('hidden');
    }

    _hideContextMenu() {
        this.contextMenu.classList.add('hidden');
    }

    // ─── Add Row ─────────────────────────────────────────────────

    async _addRow() {
        if (!this.currentTable) return;
        try {
            const res = await fetch(`/api/db/rows/${encodeURIComponent(this.currentTable)}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: {} }),
            });
            const json = await res.json();
            if (!json.ok) throw new Error(json.error);

            // Reload current page to show new row
            await this._loadData();

            // If we have a PK and the new row has one, find the new row and start editing the first non-PK cell
            const newRow = json.data;
            if (newRow && this.primaryKey) {
                const pkVal = newRow[this.primaryKey];
                if (pkVal !== null && pkVal !== undefined) {
                    const tr = this.container.querySelector(`tr[data-pk="${pkVal}"]`);
                    if (tr) {
                        // Start editing the first non-PK cell
                        const firstDataTd = tr.querySelector('td:first-child');
                        if (firstDataTd) {
                            const col = firstDataTd.dataset.col;
                            this._startCellEdit(firstDataTd, col, pkVal, this.primaryKey);
                        }
                    }
                }
            }
        } catch (err) {
            this.container.innerHTML = `<div class="placeholder-msg" style="color:var(--red)">Add failed: ${this._escapeHtml(err.message)}</div>`;
        }
    }

    // ─── Delete Row ──────────────────────────────────────────────

    async _deleteRow(pkValue, pkCol) {
        if (!this.currentTable) return;
        try {
            const res = await fetch(`/api/db/rows/${encodeURIComponent(this.currentTable)}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pk_column: pkCol,
                    pk_value: pkValue,
                }),
            });
            const json = await res.json();
            if (!json.ok) throw new Error(json.error);

            // Reload current page
            await this._loadData();
        } catch (err) {
            this.container.innerHTML = `<div class="placeholder-msg" style="color:var(--red)">Delete failed: ${this._escapeHtml(err.message)}</div>`;
        }
    }

    // ─── Sorting & Filtering ─────────────────────────────────────

    _toggleSort(col) {
        if (this.currentSortBy === col) {
            if (this.currentSortDir === 'asc') {
                this.currentSortDir = 'desc';
            } else {
                this.currentSortBy = null;
                this.currentSortDir = 'asc';
            }
        } else {
            this.currentSortBy = col;
            this.currentSortDir = 'asc';
        }
        this.currentPage = 1;
        this._loadData();
    }

    _applyGlobalFilter() {
        const val = this.filterInput.value.trim();
        this.columnFilters = {};
        if (val) {
            this.container.innerHTML = `<div class="placeholder-msg">Use column filter inputs below column headers for precise filtering.</div>`;
        }
    }

    _clearFilters() {
        this.columnFilters = {};
        this.filterInput.value = '';
        this.currentPage = 1;
        this._loadData();
    }

    // ─── Pagination ──────────────────────────────────────────────

    _updatePagination() {
        if (this.totalPages <= 1) {
            this.pagination.classList.add('hidden');
        } else {
            this.pagination.classList.remove('hidden');
            this.pageInfo.textContent = `Page ${this.currentPage} of ${this.totalPages} (${this.totalRows} rows)`;
            this.pagePrev.disabled = this.currentPage <= 1;
            this.pageNext.disabled = this.currentPage >= this.totalPages;
        }
    }

    // ─── Query Results ───────────────────────────────────────────

    showQueryResult(columns, rows) {
        this._cancelEdit();
        this.currentTable = null;
        this.currentSortBy = null;
        this.currentSortDir = 'asc';
        this.currentPage = 1;
        this.columnFilters = {};
        this.filterInput.value = '';
        this.primaryKey = null;
        this.schema = [];
        this.columns = columns;
        this.tableControls.classList.remove('hidden');
        this.tableTitle.textContent = `Query Results (${rows.length} rows)`;
        this.totalRows = rows.length;
        this.totalPages = 1;
        this.pagination.classList.add('hidden');
        this._render({columns, rows, total: rows.length, total_pages: 1});
    }

    showPlaceholder(msg) {
        this._cancelEdit();
        this.tableTitle.textContent = 'Results';
        this.tableControls.classList.add('hidden');
        this.pagination.classList.add('hidden');
        this.container.innerHTML = `<div class="placeholder-msg">${this._escapeHtml(msg)}</div>`;
    }

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
}
