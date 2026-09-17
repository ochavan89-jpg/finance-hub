import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  IndianRupee,
  Loader2,
  Percent,
  Receipt,
  RefreshCw,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatDateTime, formatInr } from '../lib/format.js'
import { supabase } from '../lib/supabase.js'
import {
  getIstMonthRange,
  getLastSixIstMonthRanges,
  sumSettlementTotals,
} from '../lib/settlements.js'
import { fetchSettlementsPage, downloadGstr1Json, downloadGstr8Json } from '../services/machineosApi.js'

const CHART_GOLD = '#C9A84C'
const TABLE_PAGE_SIZE = 100
const FETCH_LIMIT = 500
const OWNER_CAC = 6000
const CLIENT_CAC = 200
const SUPABASE_PAGE = 1000

const KPI_ITEMS = [
  { key: 'commission', label: 'MTD Commission', icon: IndianRupee, tone: 'gold' },
  { key: 'tds', label: 'MTD TDS Deducted', icon: Percent, tone: 'warning' },
  { key: 'gstTcs', label: 'MTD GST TCS (Owner)', icon: Receipt, tone: 'info' },
  { key: 'netPayouts', label: 'MTD Net Payouts', icon: Wallet, tone: 'success' },
]

const STATUS_OPTIONS = [
  { value: 'settled', label: 'Settled' },
  { value: 'pending_transfer', label: 'Pending Transfer' },
  { value: 'failed', label: 'Failed' },
  { value: 'all', label: 'All' },
]

function getErrorMessage(err) {
  if (err?.status === 401 || err?.message === 'auth_required') {
    return 'Session expired. Please login again.'
  }
  return err?.message || 'Request failed'
}

function monthsSince(isoString) {
  if (!isoString) return 1
  const from = new Date(isoString)
  if (Number.isNaN(from.getTime())) return 1
  const now = new Date()
  const months =
    (now.getFullYear() - from.getFullYear()) * 12 +
    (now.getMonth() - from.getMonth())
  return Math.max(1, months || 1)
}

async function fetchAllSupabaseRows(buildQuery) {
  const all = []
  let from = 0
  while (true) {
    const { data, error } = await buildQuery().range(from, from + SUPABASE_PAGE - 1)
    if (error) throw error
    const chunk = data || []
    all.push(...chunk)
    if (chunk.length < SUPABASE_PAGE) break
    from += SUPABASE_PAGE
  }
  return all
}

function buildSideMetrics(userIds, settlementsByUserId, cac) {
  const count = userIds.length
  if (count === 0) {
    return {
      count: 0,
      avgLtv: 0,
      cac,
      ratio: 0,
      paybackMonths: null,
      totalLtv: 0,
    }
  }

  let totalLtv = 0
  let monthlySum = 0
  let monthlyCount = 0

  for (const id of userIds) {
    const entry = settlementsByUserId.get(id) || {
      lifetime_revenue: 0,
      total_bookings: 0,
      first_booking: null,
    }
    const ltv = entry.lifetime_revenue
    totalLtv += ltv
    if (ltv > 0 && entry.first_booking) {
      monthlySum += ltv / monthsSince(entry.first_booking)
      monthlyCount += 1
    }
  }

  const avgLtv = totalLtv / count
  const ratio = cac > 0 ? avgLtv / cac : 0
  const avgMonthly = monthlyCount > 0 ? monthlySum / monthlyCount : 0
  const paybackMonths = avgMonthly > 0 ? cac / avgMonthly : null

  return {
    count,
    avgLtv,
    cac,
    ratio,
    paybackMonths,
    totalLtv,
  }
}

function aggregateSettlementsByKey(rows, key) {
  const map = new Map()
  for (const row of rows) {
    const id = row[key]
    if (id == null) continue
    const commission = Number(row.commission_amount) || 0
    const existing = map.get(id)
    if (!existing) {
      map.set(id, {
        lifetime_revenue: commission,
        total_bookings: 1,
        first_booking: row.created_at || null,
      })
      continue
    }
    existing.lifetime_revenue += commission
    existing.total_bookings += 1
    if (
      row.created_at &&
      (!existing.first_booking || row.created_at < existing.first_booking)
    ) {
      existing.first_booking = row.created_at
    }
  }
  return map
}

function formatChartInr(value) {
  const n = Number(value || 0)
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`
  if (n >= 1000) return `₹${(n / 1000).toFixed(0)}K`
  return formatInr(n)
}

async function fetchAllSettledInRange({ from, to, status = 'settled' }) {
  const all = []
  let offset = 0

  while (true) {
    const result = await fetchSettlementsPage({
      status,
      from,
      to,
      limit: FETCH_LIMIT,
      offset,
    })
    all.push(...(result.items || []))
    if (!result.hasMore) break
    offset = result.nextOffset ?? offset + FETCH_LIMIT
  }

  return all
}

function SettlementStatusPill({ status }) {
  const tone =
    status === 'settled' ? 'credit' : status === 'pending_transfer' ? 'warning' : 'debit'
  const label =
    status === 'settled'
      ? 'Settled'
      : status === 'pending_transfer'
        ? 'Pending'
        : status === 'failed'
          ? 'Failed'
          : status || '—'
  return <span className={`type-pill type-pill--${tone}`}>{label}</span>
}

function formatDiscountApplied(value) {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  const n = Number(value)
  if (Number.isFinite(n)) {
    if (n === 0) return 'No'
    if (n > 0 && n <= 100) return `${n}%`
    return formatInr(n)
  }
  return String(value)
}

function raBillField(row, key) {
  return row[key] ?? row.ra_bill?.[key] ?? row.contract_ra_bill?.[key] ?? row.booking?.[key]
}

function RouteTransferStatusPill({ status }) {
  if (!status) return <span className="type-pill type-pill--neutral">—</span>
  const s = String(status).toLowerCase()
  const tone =
    s === 'processed' ? 'credit' : s === 'pending' ? 'warning' : s === 'failed' || s === 'reversed' ? 'debit' : 'neutral'
  return <span className={`type-pill type-pill--${tone}`}>{s}</span>
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const value = payload[0]?.value
  return (
    <div className="recharts-tooltip-custom">
      <p className="recharts-tooltip-custom__label">{label}</p>
      <p className="recharts-tooltip-custom__value">{formatInr(value)} commission</p>
    </div>
  )
}

function KpiSkeletonGrid() {
  return (
    <div className="reports-kpi-grid">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="kpi-card reports-kpi-card reports-kpi-card--skeleton" aria-hidden />
      ))}
    </div>
  )
}

export default function Reports() {
  const [mtdTotals, setMtdTotals] = useState(null)
  const [mtdLoading, setMtdLoading] = useState(true)
  const [mtdError, setMtdError] = useState('')

  const [chartData, setChartData] = useState([])
  const [chartLoading, setChartLoading] = useState(true)
  const [chartError, setChartError] = useState('')

  const [tableRows, setTableRows] = useState([])
  const [tableOffset, setTableOffset] = useState(0)
  const [tableHasMore, setTableHasMore] = useState(false)
  const [tableLoading, setTableLoading] = useState(true)
  const [tableError, setTableError] = useState('')

  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [filterStatus, setFilterStatus] = useState('settled')
  const [appliedFilters, setAppliedFilters] = useState({
    from: '',
    to: '',
    status: 'settled',
  })
  const [gstr1Loading, setGstr1Loading] = useState(false)
  const [gstr1Error, setGstr1Error] = useState('')
  const [gstr1Success, setGstr1Success] = useState('')
  const [gstr8Loading, setGstr8Loading] = useState(false)
  const [gstr8Error, setGstr8Error] = useState('')
  const [gstr8Success, setGstr8Success] = useState('')

  const [ltvcacData, setLtvcacData] = useState(null)
  const [ltvcacLoading, setLtvcacLoading] = useState(true)
  const [ltvcacError, setLtvcacError] = useState('')

  const loadMtdKpis = useCallback(async () => {
    setMtdLoading(true)
    setMtdError('')
    try {
      const range = getIstMonthRange(0)
      const rows = await fetchAllSettledInRange({ from: range.from, to: range.to })
      setMtdTotals(sumSettlementTotals(rows))
    } catch (err) {
      setMtdTotals(null)
      setMtdError(getErrorMessage(err))
    } finally {
      setMtdLoading(false)
    }
  }, [])

  const loadChart = useCallback(async () => {
    setChartLoading(true)
    setChartError('')
    try {
      const ranges = getLastSixIstMonthRanges()
      const monthResults = await Promise.all(
        ranges.map(async (range) => {
          const rows = await fetchAllSettledInRange({ from: range.from, to: range.to })
          const totals = sumSettlementTotals(rows)
          return {
            month: range.label,
            commission: totals.commission,
            key: range.key,
          }
        }),
      )
      setChartData(monthResults)
    } catch (err) {
      setChartData([])
      setChartError(getErrorMessage(err))
    } finally {
      setChartLoading(false)
    }
  }, [])

  const loadTable = useCallback(async (pageOffset, filters) => {
    setTableLoading(true)
    setTableError('')
    try {
      const result = await fetchSettlementsPage({
        status: filters.status,
        from: filters.from,
        to: filters.to,
        limit: TABLE_PAGE_SIZE,
        offset: pageOffset,
      })
      setTableRows(result.items || [])
      setTableOffset(result.offset ?? pageOffset)
      setTableHasMore(Boolean(result.hasMore))
      setAppliedFilters(filters)
    } catch (err) {
      setTableRows([])
      setTableHasMore(false)
      setTableError(getErrorMessage(err))
    } finally {
      setTableLoading(false)
    }
  }, [])

  useEffect(() => {
    const defaultFilters = { from: '', to: '', status: 'settled' }
    loadMtdKpis()
    loadChart()
    loadTable(0, defaultFilters)
  }, [loadMtdKpis, loadChart, loadTable])

  const loadLtvcac = useCallback(async () => {
    setLtvcacLoading(true)
    setLtvcacError('')
    try {
      const [ownersResult, clientsResult, settlementsResult] = await Promise.all([
        (async () => {
          try {
            return await fetchAllSupabaseRows(() =>
              supabase.from('users').select('id').eq('role', 'owner').eq('status', 'active'),
            )
          } catch {
            return null
          }
        })(),
        (async () => {
          try {
            return await fetchAllSupabaseRows(() =>
              supabase.from('users').select('id').eq('role', 'client').eq('status', 'active'),
            )
          } catch {
            return null
          }
        })(),
        (async () => {
          try {
            return await fetchAllSupabaseRows(() =>
              supabase
                .from('booking_settlements')
                .select('owner_id, client_id, commission_amount, created_at'),
            )
          } catch {
            return null
          }
        })(),
      ])

      if (
        ownersResult === null ||
        clientsResult === null ||
        settlementsResult === null
      ) {
        setLtvcacData(null)
        setLtvcacError('Failed to load LTV:CAC data. Please try again.')
        return
      }

      const ownerIds = ownersResult.map((u) => u.id)
      const clientIds = clientsResult.map((u) => u.id)
      const byOwner = aggregateSettlementsByKey(settlementsResult, 'owner_id')
      const byClient = aggregateSettlementsByKey(settlementsResult, 'client_id')

      const owners = buildSideMetrics(ownerIds, byOwner, OWNER_CAC)
      const clients = buildSideMetrics(clientIds, byClient, CLIENT_CAC)

      const totalSpend = owners.count * OWNER_CAC + clients.count * CLIENT_CAC
      const totalLtv = owners.totalLtv + clients.totalLtv
      const returnPerRupee = totalSpend > 0 ? totalLtv / totalSpend : 0

      setLtvcacData({ owners, clients, returnPerRupee })
    } catch (err) {
      setLtvcacData(null)
      setLtvcacError(getErrorMessage(err) || 'Failed to load LTV:CAC data. Please try again.')
    } finally {
      setLtvcacLoading(false)
    }
  }, [])

  useEffect(() => {
    loadLtvcac()
  }, [loadLtvcac])

  function applyTableFilters() {
    const next = { from: filterFrom, to: filterTo, status: filterStatus }
    loadTable(0, next)
  }

  async function handleGstr1Download() {
    setGstr1Loading(true)
    setGstr1Error('')
    setGstr1Success('')
    try {
      const { filename } = await downloadGstr1Json(filterFrom, filterTo)
      setGstr1Success(`Downloaded ${filename}`)
    } catch (err) {
      setGstr1Error(getErrorMessage(err))
    } finally {
      setGstr1Loading(false)
    }
  }

  async function handleGstr8Download() {
    setGstr8Loading(true)
    setGstr8Error('')
    setGstr8Success('')
    try {
      const { filename } = await downloadGstr8Json(filterFrom, filterTo)
      setGstr8Success(`Downloaded ${filename}`)
    } catch (err) {
      setGstr8Error(getErrorMessage(err))
    } finally {
      setGstr8Loading(false)
    }
  }

  function goTablePrev() {
    if (tableOffset <= 0 || tableLoading) return
    loadTable(Math.max(0, tableOffset - TABLE_PAGE_SIZE), appliedFilters)
  }

  function goTableNext() {
    if (!tableHasMore || tableLoading) return
    loadTable(tableOffset + TABLE_PAGE_SIZE, appliedFilters)
  }

  const tableRangeStart = tableRows.length ? tableOffset + 1 : 0
  const tableRangeEnd = tableOffset + tableRows.length

  const maxChartCommission = useMemo(
    () => Math.max(...chartData.map((d) => d.commission), 1),
    [chartData],
  )

  function formatKpiValue(key) {
    if (mtdLoading && !mtdTotals) return '—'
    if (!mtdTotals) return '—'
    switch (key) {
      case 'commission':
        return formatInr(mtdTotals.commission)
      case 'tds':
        return formatInr(mtdTotals.tds)
      case 'gstTcs':
        return formatInr(mtdTotals.gstTcs)
      case 'netPayouts':
        return formatInr(mtdTotals.netPayouts)
      default:
        return '—'
    }
  }

  return (
    <div className="reports-page">
      <section className="reports-kpi-strip" aria-label="Month to date settlement summary">
        {mtdError && (
          <div className="dashboard-error treasury-banner" role="alert">
            <span>{mtdError}</span>
            <button type="button" className="treasury-retry-btn" onClick={loadMtdKpis}>
              <RefreshCw size={14} />
              Retry
            </button>
          </div>
        )}
        <p className="reports-kpi-note">Settled · IST month to date</p>
        {mtdLoading && !mtdTotals ? (
          <KpiSkeletonGrid />
        ) : (
          <div className="reports-kpi-grid">
            {KPI_ITEMS.map(({ key, label, icon: Icon, tone }) => (
              <div key={key} className="kpi-card reports-kpi-card">
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
        )}
      </section>

      <section className="section-card reports-chart-section">
        <div className="reports-chart-header">
          <div className="reports-chart-title">
            <BarChart3 size={18} strokeWidth={1.75} />
            <h2>Platform Commission Revenue</h2>
          </div>
          <p className="reports-chart-subtitle">Last 6 months · settled settlements · IST</p>
        </div>

        {chartError && (
          <div className="dashboard-error treasury-banner reports-section-msg" role="alert">
            <span>{chartError}</span>
            <button type="button" className="treasury-retry-btn" onClick={loadChart}>
              <RefreshCw size={14} />
              Retry
            </button>
          </div>
        )}

        <div className="reports-chart-container">
          {chartLoading ? (
            <div className="reports-chart-skeleton" aria-live="polite">
              <Loader2 size={22} className="treasury-spin" />
              <span>Loading chart…</span>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} margin={{ top: 12, right: 12, left: 4, bottom: 4 }}>
                <XAxis
                  dataKey="month"
                  tick={{ fill: '#8896a8', fontSize: 11 }}
                  axisLine={{ stroke: 'rgba(201, 168, 76, 0.2)' }}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={formatChartInr}
                  domain={[0, maxChartCommission * 1.1]}
                  tick={{ fill: '#8896a8', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                  width={56}
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(201, 168, 76, 0.08)' }} />
                <Bar dataKey="commission" radius={[6, 6, 0, 0]} maxBarSize={48}>
                  {chartData.map((entry) => (
                    <Cell key={entry.key} fill={CHART_GOLD} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section className="section-card" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="reports-chart-header">
          <div className="reports-chart-title">
            <TrendingUp size={18} strokeWidth={1.75} />
            <h2>LTV : CAC Analysis</h2>
          </div>
          <p className="reports-chart-subtitle">
            Owner CAC ₹{OWNER_CAC.toLocaleString('en-IN')} · Client CAC ₹{CLIENT_CAC.toLocaleString('en-IN')}
          </p>
        </div>

        {ltvcacError && (
          <div className="dashboard-error treasury-banner reports-section-msg" role="alert">
            <span>{ltvcacError}</span>
            <button type="button" className="treasury-retry-btn" onClick={loadLtvcac}>
              <RefreshCw size={14} />
              Retry
            </button>
          </div>
        )}

        {ltvcacLoading ? (
          <div className="treasury-balance-stats" aria-hidden>
            <div className="kpi-card reports-kpi-card reports-kpi-card--skeleton" />
            <div className="kpi-card reports-kpi-card reports-kpi-card--skeleton" />
          </div>
        ) : !ltvcacData || (ltvcacData.owners.count === 0 && ltvcacData.clients.count === 0) ? (
          !ltvcacError ? (
            <div className="transactions-empty">
              <p>No data yet</p>
            </div>
          ) : null
        ) : (
          <>
            <div className="treasury-balance-stats">
              {[
                {
                  key: 'owners',
                  title: 'Owners',
                  side: ltvcacData.owners,
                  countLabel: 'Active owners',
                },
                {
                  key: 'clients',
                  title: 'Clients',
                  side: ltvcacData.clients,
                  countLabel: 'Active clients',
                },
              ].map(({ key, title, side, countLabel }) => (
                <div key={key} className="kpi-card" style={{ minHeight: 'auto' }}>
                  <div className="kpi-card-glow kpi-card-glow--gold" aria-hidden />
                  <div className="kpi-card-label" style={{ marginBottom: '0.75rem' }}>
                    {title}
                  </div>
                  <div className="settings-rows" style={{ gap: '0.65rem' }}>
                    <div className="settings-row" style={{ padding: '0.35rem 0' }}>
                      <span className="settings-label">{countLabel}</span>
                      <span className="settings-value">{side.count}</span>
                    </div>
                    <div className="settings-row" style={{ padding: '0.35rem 0' }}>
                      <span className="settings-label">Avg LTV</span>
                      <span className="settings-value settings-value--gold">
                        {formatInr(side.avgLtv)}
                      </span>
                    </div>
                    <div className="settings-row" style={{ padding: '0.35rem 0' }}>
                      <span className="settings-label">CAC</span>
                      <span className="settings-value">{formatInr(side.cac)}</span>
                    </div>
                    <div className="settings-row" style={{ padding: '0.35rem 0' }}>
                      <span className="settings-label">LTV : CAC</span>
                      <span
                        className="kpi-card-value"
                        style={{ color: 'var(--gold)', fontSize: '1.75rem' }}
                      >
                        {side.ratio.toFixed(2)}x
                      </span>
                    </div>
                    <div className="settings-row" style={{ padding: '0.35rem 0', borderBottom: 'none' }}>
                      <span className="settings-label">Payback</span>
                      <span className="settings-value">
                        {side.paybackMonths == null
                          ? '—'
                          : `${side.paybackMonths.toFixed(1)} months`}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p
              className="reports-chart-subtitle"
              style={{ marginTop: 'var(--space-4)', marginBottom: 0 }}
            >
              Every ₹1 spent on acquisition returns ₹
              {ltvcacData.returnPerRupee.toFixed(2)}
            </p>
          </>
        )}
      </section>

      <section className="section-card reports-table-section">
        <div className="reports-table-header">
          <h2>Settlement Ledger</h2>
        </div>

        {gstr1Error && (
          <div className="dashboard-error treasury-banner reports-section-msg" role="alert">
            {gstr1Error}
          </div>
        )}
        {gstr1Success && (
          <div className="treasury-success export-section-msg" role="status">
            {gstr1Success}
          </div>
        )}
        {gstr8Error && (
          <div className="dashboard-error treasury-banner reports-section-msg" role="alert">
            {gstr8Error}
          </div>
        )}
        {gstr8Success && (
          <div className="treasury-success export-section-msg" role="status">
            {gstr8Success}
          </div>
        )}

        {tableError && (
          <div className="dashboard-error treasury-banner reports-section-msg" role="alert">
            <span>{tableError}</span>
            <button
              type="button"
              className="treasury-retry-btn"
              onClick={() => loadTable(tableOffset, appliedFilters)}
            >
              <RefreshCw size={14} />
              Retry
            </button>
          </div>
        )}

        <div className="filter-bar">
          <div className="filter-bar-group">
            <label className="filter-bar-label" htmlFor="reports-filter-from">
              From
            </label>
            <input
              id="reports-filter-from"
              type="date"
              className="filter-bar-input"
              value={filterFrom}
              onChange={(e) => setFilterFrom(e.target.value)}
            />
          </div>
          <div className="filter-bar-group">
            <label className="filter-bar-label" htmlFor="reports-filter-to">
              To
            </label>
            <input
              id="reports-filter-to"
              type="date"
              className="filter-bar-input"
              value={filterTo}
              onChange={(e) => setFilterTo(e.target.value)}
            />
          </div>
          <div className="filter-bar-group">
            <label className="filter-bar-label" htmlFor="reports-filter-status">
              Status
            </label>
            <select
              id="reports-filter-status"
              className="filter-bar-select"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              {STATUS_OPTIONS.map(({ value, label }) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="reports-apply-btn" onClick={applyTableFilters}>
            Apply
          </button>
          <button
            type="button"
            className="export-csv-btn"
            onClick={handleGstr1Download}
            disabled={gstr1Loading}
          >
            {gstr1Loading ? (
              <>
                <Loader2 size={16} className="treasury-spin" />
                Exporting…
              </>
            ) : (
              <>
                <Receipt size={16} />
                GSTR-1 JSON
              </>
            )}
          </button>
          <button
            type="button"
            className="export-csv-btn"
            onClick={handleGstr8Download}
            disabled={gstr8Loading}
          >
            {gstr8Loading ? (
              <>
                <Loader2 size={16} className="treasury-spin" />
                Exporting…
              </>
            ) : (
              <>
                <Wallet size={16} />
                GSTR-8 TCS
              </>
            )}
          </button>
          <p style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: '4px' }}>
            ECO bookings only (Sec 52)
          </p>
        </div>

        <div className="ledger-table-wrap">
          {tableLoading ? (
            <div className="transactions-table-loading" aria-live="polite">
              <Loader2 size={22} className="treasury-spin" />
              <span>Loading settlements…</span>
            </div>
          ) : tableRows.length === 0 ? (
            <div className="transactions-empty">
              <p>No settlements match the selected filters.</p>
            </div>
          ) : (
            <table className="ledger-table reports-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Booking Ref</th>
                  <th>Owner</th>
                  <th>Gross</th>
                  <th>Commission</th>
                  <th>TDS</th>
                  <th>GST TCS</th>
                  <th>Net Payout</th>
                  <th>Route Transfer</th>
                  <th>Pay By</th>
                  <th>Early Deadline</th>
                  <th>Early Discount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row) => (
                  <tr key={row.id} className="ledger-row">
                    <td data-label="Date">{formatDateTime(row.created_at)}</td>
                    <td data-label="Booking Ref">
                      <span className="ledger-ref">{row.booking_ref || '—'}</span>
                    </td>
                    <td data-label="Owner">{row.owner?.name || '—'}</td>
                    <td data-label="Gross">{formatInr(row.gross_amount)}</td>
                    <td data-label="Commission">
                      <span className="reports-commission">{formatInr(row.commission_amount)}</span>
                    </td>
                    <td data-label="TDS">{formatInr(row.tds_amount)}</td>
                    <td data-label="GST TCS">{formatInr(row.gst_tcs_amount)}</td>
                    <td data-label="Net Payout">
                      <span className="reports-net-payout">{formatInr(row.net_owner_amount)}</span>
                    </td>
                    <td data-label="Route Transfer">
                      <RouteTransferStatusPill
                        status={row.route_transfer_status || row.booking?.route_transfer_status}
                      />
                    </td>
                    <td data-label="Pay By">
                      {formatDateTime(raBillField(row, 'payment_due_date'))}
                    </td>
                    <td data-label="Early Deadline">
                      {formatDateTime(raBillField(row, 'early_payment_deadline'))}
                    </td>
                    <td data-label="Early Discount">
                      {formatDiscountApplied(raBillField(row, 'early_payment_discount_applied'))}
                    </td>
                    <td data-label="Status">
                      <SettlementStatusPill status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="pagination-controls">
          <p className="pagination-label">
            {tableRows.length
              ? `Showing ${tableRangeStart}–${tableRangeEnd} (offset ${tableOffset})`
              : `No rows (offset ${tableOffset})`}
          </p>
          <div className="pagination-actions">
            <button
              type="button"
              className="pagination-btn"
              onClick={goTablePrev}
              disabled={tableLoading || tableOffset <= 0}
            >
              Prev
            </button>
            <button
              type="button"
              className="pagination-btn pagination-btn--primary"
              onClick={goTableNext}
              disabled={tableLoading || !tableHasMore}
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
