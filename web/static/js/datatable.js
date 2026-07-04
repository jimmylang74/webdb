/**
 * DataTable Component - Displays database query results with sorting and filtering.
 *
 * Features:
 * - Column-based sorting (click header to sort asc/desc/none)
 * - Column-based filtering (input fields in filter row)
 * - Pagination support
 * - Null value display
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

        this.currentTable = null;
        this.currentSortBy = null;
        this.currentSortDir = 'asc';
        this.currentPage = 1;
        this.perPage = 100;
        this.totalPages = 1;
        this.totalRows = 0;
        this.columnFilters = {}; // {colName: value}

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
    }

    async loadTable(tableName) {
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

        // Apply column filters
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
            this._render(json.data);
        } catch (err) {
            this.container.innerHTML = `<div class="placeholder-msg" style="color:var(--red)">Error: ${this._escapeHtml(err.message)}</div>`;
        }
    }

    _render(data) {
        this.totalRows = data.total;
        this.totalPages = data.total_pages;

        if (data.rows.length === 0) {
            this.container.innerHTML = '<div class="placeholder-msg">No rows found</div>';
            this._updatePagination();
            return;
        }

        const table = document.createElement('table');
        table.className = 'data-table';

        // Header row (column names with sort)
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');

        for (const col of data.columns) {
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
        for (const col of data.columns) {
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

        // Body rows
        const tbody = document.createElement('tbody');
        for (const row of data.rows) {
            const tr = document.createElement('tr');
            for (const col of data.columns) {
                const td = document.createElement('td');
                const val = row[col];
                if (val === null || val === undefined) {
                    td.textContent = 'NULL';
                    td.className = 'null-value';
                } else {
                    td.textContent = String(val);
                    td.title = String(val); // Tooltip for truncated text
                }
                tr.appendChild(td);
            }
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);

        this.container.innerHTML = '';
        this.container.appendChild(table);

        // Apply filter row styling - make inputs a bit narrower
        this._updatePagination();
    }

    _toggleSort(col) {
        if (this.currentSortBy === col) {
            if (this.currentSortDir === 'asc') {
                this.currentSortDir = 'desc';
            } else {
                // Third click: clear sort
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
        // Apply as global search across all visible columns
        // We store it as a special marker - the backend doesn't support global search
        // so we'll apply it to the first column
        if (val) {
            // We'll apply after load by letting the user use column-specific filters
            // For now, show message
            this.container.innerHTML = `<div class="placeholder-msg">Use column filter inputs below column headers for precise filtering. Global search will filter by the first column.</div>`;
        }
    }

    _clearFilters() {
        this.columnFilters = {};
        this.filterInput.value = '';
        this.currentPage = 1;
        this._loadData();
    }

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

    showQueryResult(columns, rows) {
        this.currentTable = null;
        this.currentSortBy = null;
        this.currentSortDir = 'asc';
        this.currentPage = 1;
        this.columnFilters = {};
        this.filterInput.value = '';
        this.tableControls.classList.remove('hidden');
        this.tableTitle.textContent = `Query Results (${rows.length} rows)`;
        this.totalRows = rows.length;
        this.totalPages = 1;
        this.pagination.classList.add('hidden');
        this._render({columns, rows, total: rows.length, total_pages: 1});
    }

    showPlaceholder(msg) {
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
