import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowDownCircle,
  ArrowUpCircle,
  Hash,
  Loader2,
  RefreshCw,
  Scale,
  X,
} from 'lucide-react'
import {
  downloadReconciliationCsv,
  fetchTransactionsPage,
} from '../services/machineosApi.js'
import { formatCount, formatDateTime, formatInr } from '../lib/format.js'

const PAGE_SIZE = 100
const EXPORT_LIMITS = [500, 1000, 2000, 5000]

function getErrorMessage(err) {
  if (err?.status === 401 || err?.message === 'auth_required') {
    return 'Session expired. Please login again.'
  }
  return err?.message || 'Failed to load transactions'
}

function truncateText(value, max = 48) {
  if (!value) return '—'
  const text = String(value)
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

function isInDateRange(isoString, from, to) {
  if (!isoString) return false
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return false

  if (from) {
    const start = new Date(from)
    start.setHours(0, 0, 0, 0)
    if (date < start) return false
  }

  if (to) {
    const end = new Date(to)
    end.setHours(23, 59, 59, 999)
    if (date > end) return false
  }

  return true
}

function computeKpis(rows) {
  let totalCredits = 0
  let totalDebits = 0

  for (const tx of rows) {
    const amount = Math.abs(Number(tx.amount || 0))
    if (String(tx.type || '').toLowerCase() === 'credit') {
      totalCredits += amount
    } else {
      totalDebits += amount
    }
  }

  return {
    totalCredits,
    totalDebits,
    netBalance: totalCredits - totalDebits,
    totalCount: rows.length,
  }
}

const KPI_ITEMS = [
  { key: 'totalCredits', label: 'Total Credits', icon: ArrowDownCircle, tone: 'success' },
  { key: 'totalDebits', label: 'Total Debits', icon: ArrowUpCircle, tone: 'warning' },
  { key: 'netBalance', label: 'Net Balance', icon: Scale, tone: 'gold' },
  { key: 'totalCount', label: 'Total Transactions', icon: Hash, tone: 'info' },
]

export default function Transactions() {
  const [items, setItems] = useState([])
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [filterType, setFilterType] = useState('all')

  const [exportFrom, setExportFrom] = useState('')
  const [exportTo, setExportTo] = useState('')
  const [exportLimit, setExportLimit] = useState(2000)
  const [exportLoading, setExportLoading] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exportSuccess, setExportSuccess] = useState('')

  const loadPage = useCallback(async (pageOffset) => {
    setLoading(true)
    setLoadError('')

    try {
      const result = await fetchTransactionsPage({ limit: PAGE_SIZE, offset: pageOffset })
      setItems(result.items || [])
      setOffset(result.offset ?? pageOffset)
      setHasMore(Boolean(result.hasMore))
    } catch (err) {
      setItems([])
      setHasMore(false)
      setLoadError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPage(0)
  }, [loadPage])

  const filteredRows = useMemo(() => {
    return items.filter((tx) => {
      const type = String(tx.type || '').toLowerCase()
      const typeOk = filterType === 'all' || type === filterType
      const dateOk = isInDateRange(tx.created_at, filterFrom, filterTo)
      return typeOk && dateOk
    })
  }, [items, filterFrom, filterTo, filterType])

  const kpis = useMemo(() => computeKpis(filteredRows), [filteredRows])

  const hasActiveFilters = filterFrom || filterTo || filterType !== 'all'

  function clearFilters() {
    setFilterFrom('')
    setFilterTo('')
    setFilterType('all')
  }

  function goPrev() {
    if (offset <= 0 || loading) return
    loadPage(Math.max(0, offset - PAGE_SIZE))
  }

  function goNext() {
    if (!hasMore || loading) return
    loadPage(offset + PAGE_SIZE)
  }

  async function handleExport() {
    setExportLoading(true)
    setExportError('')
    setExportSuccess('')

    try {
      const { filename } = await downloadReconciliationCsv({
        from: exportFrom,
        to: exportTo,
        limit: exportLimit,
      })
      setExportSuccess(`Downloaded ${filename}`)
    } catch (err) {
      setExportError(getErrorMessage(err))
    } finally {
      setExportLoading(false)
    }
  }

  const rangeStart = filteredRows.length ? offset + 1 : 0
  const rangeEnd = offset + filteredRows.length

  function formatKpiValue(key) {
    if (loading && !items.length) return '—'
    switch (key) {
      case 'totalCredits':
        return formatInr(kpis.totalCredits)
      case 'totalDebits':
        return formatInr(kpis.totalDebits)
      case 'netBalance':
        return formatInr(kpis.netBalance)
      case 'totalCount':
        return formatCount(kpis.totalCount)
      default:
        return '—'
    }
  }

  return (
    <div className="transactions-page">
      {loadError && (
        <div className="dashboard-error treasury-banner" role="alert">
          <span>{loadError}</span>
          <button type="button" className="treasury-retry-btn" onClick={() => loadPage(offset)}>
            <RefreshCw size={14} />
            Retry
          </button>
        </div>
      )}

      <section className="transactions-kpi-strip" aria-label="Transaction summary">
        <p className="transactions-kpi-note">For loaded/filtered rows on this page</p>
        <div className="transactions-kpi-grid">
          {KPI_ITEMS.map(({ key, label, icon: Icon, tone }) => (
            <div key={key} className="kpi-card transactions-kpi-card">
              <div className={`kpi-card-glow kpi-card-glow--${tone}`} aria-hidden />
              <div className="kpi-card-top">
                <div className={`kpi-card-icon kpi-card-icon--${tone}`}>
                  <Icon size={22} strokeWidth={1.75} />
                </div>
              </div>
              <div className="kpi-card-value">{formatKpiValue(key)}</div>
              <div className="kpi-card-label">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="section-card transactions-section">
        <div className="filter-bar">
          <div className="filter-bar-group">
            <label className="filter-bar-label" htmlFor="txn-filter-from">
              From
            </label>
            <input
              id="txn-filter-from"
              type="date"
              className="filter-bar-input"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
            />
          </div>
          <div className="filter-bar-group">
            <label className="filter-bar-label" htmlFor="txn-filter-to">
              To
            </label>
            <input
              id="txn-filter-to"
              type="date"
              className="filter-bar-input"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
            />
          </div>
          <div className="filter-bar-group">
            <label className="filter-bar-label" htmlFor="txn-filter-type">
              Type
            </label>
            <select
              id="txn-filter-type"
              className="filter-bar-select"
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              <option value="all">All</option>
              <option value="credit">Credit</option>
              <option value="debit">Debit</option>
            </select>
          </div>
          {hasActiveFilters && (
            <button type="button" className="filter-bar-clear" onClick={clearFilters}>
              <X size={14} />
              Clear filters
            </button>
          )}
        </div>

        <div className="ledger-table-wrap">
          {loading ? (
            <div className="transactions-table-loading" aria-live="polite">
              <Loader2 size={22} className="treasury-spin" />
              <span>Loading transactions…</span>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="transactions-empty">
              <p>No transactions match the current filters on this page.</p>
              {hasActiveFilters && (
                <button type="button" className="filter-bar-clear" onClick={clearFilters}>
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Date / Time</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Reference</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((tx) => {
                  const type = String(tx.type || '').toLowerCase()
                  const isCredit = type === 'credit'
                  return (
                    <tr key={tx.id ?? `${tx.reference}-${tx.created_at}`} className="ledger-row">
                      <td data-label="Date / Time">{formatDateTime(tx.created_at)}</td>
                      <td data-label="Type">
                        <span className={`type-pill type-pill--${isCredit ? 'credit' : 'debit'}`}>
                          {isCredit ? 'Credit' : 'Debit'}
                        </span>
                      </td>
                      <td data-label="Amount">{formatInr(tx.amount)}</td>
                      <td data-label="Reference">
                        <span className="ledger-ref" title={tx.reference || ''}>
                          {truncateText(tx.reference, 32)}
                        </span>
                      </td>
                      <td data-label="Description" title={tx.description || ''}>
                        {truncateText(tx.description, 56)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="pagination-controls">
          <p className="pagination-label">
            {filteredRows.length
              ? `Showing ${rangeStart}–${rangeEnd} rows (offset ${offset})`
              : `No rows on this page (offset ${offset})`}
          </p>
          <div className="pagination-actions">
            <button
              type="button"
              className="pagination-btn"
              onClick={goPrev}
              disabled={loading || offset <= 0}
            >
              Prev
            </button>
            <button
              type="button"
              className="pagination-btn pagination-btn--primary"
              onClick={goNext}
              disabled={loading || !hasMore}
            >
              Next
            </button>
          </div>
        </div>
      </section>

      <section className="section-card export-section">
        <div className="export-section-header">
          <div className="export-section-title">
            <ArrowDownToLine size={18} strokeWidth={1.75} />
            <h2>Export CSV</h2>
          </div>
          <p className="export-section-hint">
            Server-side reconciliation export with date range (max {exportLimit.toLocaleString('en-IN')} rows).
          </p>
        </div>

        {exportError && (
          <div className="dashboard-error export-section-msg" role="alert">
            {exportError}
          </div>
        )}
        {exportSuccess && (
          <div className="treasury-success export-section-msg" role="status">
            {exportSuccess}
          </div>
        )}

        <div className="export-section-form">
          <div className="filter-bar-group">
            <label className="filter-bar-label" htmlFor="export-from">
              From
            </label>
            <input
              id="export-from"
              type="date"
              className="filter-bar-input"
              value={exportFrom}
              onChange={(e) => setExportFrom(e.target.value)}
            />
          </div>
          <div className="filter-bar-group">
            <label className="filter-bar-label" htmlFor="export-to">
              To
            </label>
            <input
              id="export-to"
              type="date"
              className="filter-bar-input"
              value={exportTo}
              onChange={(e) => setExportTo(e.target.value)}
            />
          </div>
          <div className="filter-bar-group">
            <label className="filter-bar-label" htmlFor="export-limit">
              Limit
            </label>
            <select
              id="export-limit"
              className="filter-bar-select"
              value={exportLimit}
              onChange={(e) => setExportLimit(Number(e.target.value))}
            >
              {EXPORT_LIMITS.map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString('en-IN')}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="export-csv-btn"
            onClick={handleExport}
            disabled={exportLoading}
          >
            {exportLoading ? (
              <>
                <Loader2 size={16} className="treasury-spin" />
                Exporting…
              </>
            ) : (
              <>
                <ArrowDownToLine size={16} />
                Export CSV
              </>
            )}
          </button>
        </div>
      </section>
    </div>
  )
}
