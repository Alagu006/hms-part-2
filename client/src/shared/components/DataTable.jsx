import { useState, useMemo, useCallback } from 'react';
import EmptyState from './EmptyState.jsx';
import styles from './DataTable.module.scss';

/**
 * Reusable DataTable with:
 *  - Column sorting (click header)
 *  - Global text filter
 *  - Client-side pagination
 *  - CSV export
 *  - Sticky header
 *  - Row hover highlight
 *  - Accessible markup
 *
 * Props:
 *   columns   Array<{ key, label, render?, sortable?, width? }>
 *   data      Array<object>
 *   pageSize  number  (default 20)
 *   searchable bool   (default true)
 *   exportable bool   (default false)
 *   exportFilename string
 *   emptyIcon  string
 *   emptyTitle string
 *   emptyMessage string
 *   loading   bool
 *   onRowClick (row) => void
 */
export default function DataTable({
  columns = [],
  data = [],
  pageSize = 20,
  searchable = true,
  exportable = false,
  exportFilename = 'export',
  emptyIcon = '📋',
  emptyTitle = 'No data',
  emptyMessage,
  loading = false,
  onRowClick,
}) {
  const [query,   setQuery]   = useState('');
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc'); // 'asc' | 'desc'
  const [page,    setPage]    = useState(1);

  // Filter
  const filtered = useMemo(() => {
    if (!query.trim()) return data;
    const q = query.toLowerCase();
    return data.filter(row =>
      columns.some(col => {
        const val = row[col.key];
        return val != null && String(val).toLowerCase().includes(q);
      })
    );
  }, [data, query, columns]);

  // Sort
  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  // Paginate
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paginated  = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page, pageSize]);

  // Reset page when filter/sort changes
  const handleQuery = useCallback((e) => {
    setQuery(e.target.value);
    setPage(1);
  }, []);

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
    setPage(1);
  }

  // CSV export
  function exportCSV() {
    const header = columns.map(c => c.label).join(',');
    const rows   = sorted.map(row =>
      columns.map(col => {
        const val = row[col.key] ?? '';
        const str = String(val).replace(/"/g, '""');
        return str.includes(',') || str.includes('"') ? '"' + str + '"' : str;
      }).join(',')
    );
    const csv  = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = exportFilename + '.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className={styles.wrapper}>
      {/* Toolbar */}
      {(searchable || exportable) && (
        <div className={styles.toolbar}>
          {searchable && (
            <div className={styles.searchWrap}>
              <svg className={styles.searchIcon} width="14" height="14" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
              <input
                className={styles.searchInput}
                type="search"
                placeholder="Filter…"
                value={query}
                onChange={handleQuery}
                aria-label="Filter table"
              />
            </div>
          )}
          <div className={styles.toolbarRight}>
            <span className={styles.count}>
              {filtered.length} {filtered.length === 1 ? 'row' : 'rows'}
            </span>
            {exportable && (
              <button className={styles.exportBtn} onClick={exportCSV} title="Export to CSV">
                ↓ CSV
              </button>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div className={styles.tableWrap}>
        <table className={styles.table} aria-label="Data table">
          <thead>
            <tr>
              {columns.map(col => (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  className={col.sortable !== false ? styles.sortable : ''}
                  onClick={col.sortable !== false ? () => handleSort(col.key) : undefined}
                  aria-sort={
                    sortKey === col.key
                      ? sortDir === 'asc' ? 'ascending' : 'descending'
                      : 'none'
                  }
                >
                  <span className={styles.thInner}>
                    {col.label}
                    {col.sortable !== false && (
                      <span className={styles.sortIcon} aria-hidden="true">
                        {sortKey === col.key
                          ? sortDir === 'asc' ? ' ↑' : ' ↓'
                          : ' ↕'}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {columns.map(col => (
                    <td key={col.key}>
                      <div className={styles.skeleton} style={{ width: '70%' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : paginated.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className={styles.emptyCell}>
                  <EmptyState
                    icon={emptyIcon}
                    title={emptyTitle}
                    message={emptyMessage}
                    compact
                  />
                </td>
              </tr>
            ) : (
              paginated.map((row, i) => (
                <tr
                  key={row.id ?? i}
                  className={onRowClick ? styles.clickable : ''}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  tabIndex={onRowClick ? 0 : undefined}
                  onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
                >
                  {columns.map(col => (
                    <td key={col.key}>
                      {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className={styles.pagination} role="navigation" aria-label="Table pagination">
          <button
            className={styles.pageBtn}
            onClick={() => setPage(1)}
            disabled={page === 1}
            aria-label="First page"
          >«</button>
          <button
            className={styles.pageBtn}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            aria-label="Previous page"
          >‹</button>

          {/* Page numbers */}
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            let p;
            if (totalPages <= 5) {
              p = i + 1;
            } else if (page <= 3) {
              p = i + 1;
            } else if (page >= totalPages - 2) {
              p = totalPages - 4 + i;
            } else {
              p = page - 2 + i;
            }
            return (
              <button
                key={p}
                className={`${styles.pageBtn} ${p === page ? styles.pageBtnActive : ''}`}
                onClick={() => setPage(p)}
                aria-label={'Page ' + p}
                aria-current={p === page ? 'page' : undefined}
              >
                {p}
              </button>
            );
          })}

          <button
            className={styles.pageBtn}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            aria-label="Next page"
          >›</button>
          <button
            className={styles.pageBtn}
            onClick={() => setPage(totalPages)}
            disabled={page === totalPages}
            aria-label="Last page"
          >»</button>
        </div>
      )}
    </div>
  );
}
