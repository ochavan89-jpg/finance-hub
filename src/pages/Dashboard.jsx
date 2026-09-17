import { useCallback, useEffect, useState } from 'react'
import { useAuthStore } from '../store/authStore.js'
import { apiFetch } from '../services/machineosApi.js'
import { formatCount, formatInr, formatMonthLabel } from '../lib/format.js'
import { supabase } from '../lib/supabase.js'
import {
  Activity,
  BarChart2,
  BarChart3,
  Clock,
  Landmark,
  RefreshCw,
  TrendingUp,
} from 'lucide-react'

const PL_DEPRECIATION = 5000
const PL_TAX_RATE = 0.25
const AVAILABLE_HOURS_PER_MONTH = 26 * 8
const UE_INFRA_FIXED = 3000
const UE_GATEWAY_FALLBACK_PCT = 0.02

const OPEX_KEYS = [
  'hetzner_vps',
  'supabase',
  'railway',
  'whatsapp_api',
  'razorpay_fees',
  'salary_engineer',
  'salary_sales',
  'marketing',
  'other',
]

function getCurrentMonthYear() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function monthBounds(monthYear) {
  const [y, m] = monthYear.split('-').map(Number)
  const start = `${monthYear}-01T00:00:00.000Z`
  const endMonth =
    m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  const end = `${endMonth}-01T00:00:00.000Z`
  return { start, end }
}

function sumOpexRow(row) {
  if (!row) return 0
  return OPEX_KEYS.reduce((sum, key) => sum + (Number(row[key]) || 0), 0)
}

function calcPlMetrics(revenue, opex) {
  const ebitda = revenue - opex
  const preTax = ebitda - PL_DEPRECIATION
  const tax = preTax > 0 ? preTax * PL_TAX_RATE : 0
  const pat = preTax - tax
  return { ebitda, pat }
}

function utilTone(pct) {
  if (pct > 60) return 'success'
  if (pct > 40) return 'warning'
  return 'danger'
}

function utilColor(pct) {
  const tone = utilTone(pct)
  if (tone === 'success') return 'var(--success)'
  if (tone === 'warning') return 'var(--warning)'
  return '#f87171'
}

function formatUtilPct(pct) {
  return `${pct.toFixed(1)}%`
}

function cmTone(pct) {
  if (pct > 70) return 'success'
  if (pct > 50) return 'warning'
  return 'danger'
}

function cmColor(pct) {
  const tone = cmTone(pct)
  if (tone === 'success') return 'var(--success)'
  if (tone === 'warning') return 'var(--warning)'
  return '#f87171'
}

function calcUeMetrics(rows, hasRazorpayFee) {
  const bookingCount = rows.length
  if (bookingCount === 0) {
    return {
      bookingCount: 0,
      avgGbv: 0,
      avgCommission: 0,
      avgGateway: 0,
      avgInfra: 0,
      contributionMargin: 0,
      cmPct: 0,
    }
  }

  let totalGbv = 0
  let totalCommission = 0
  let totalGateway = 0

  for (const row of rows) {
    const gbv = Number(row.gbv) || 0
    totalGbv += gbv
    totalCommission += Number(row.commission_amount) || 0
    if (hasRazorpayFee) {
      totalGateway += Number(row.razorpay_fee) || 0
    }
  }

  if (!hasRazorpayFee) {
    totalGateway = totalGbv * UE_GATEWAY_FALLBACK_PCT
  }

  const avgGbv = totalGbv / bookingCount
  const avgCommission = totalCommission / bookingCount
  const avgGateway = totalGateway / bookingCount
  const avgInfra = UE_INFRA_FIXED / bookingCount
  const contributionMargin = avgCommission - avgGateway - avgInfra
  const cmPct =
    avgCommission > 0 ? (contributionMargin / avgCommission) * 100 : 0

  return {
    bookingCount,
    avgGbv,
    avgCommission,
    avgGateway,
    avgInfra,
    contributionMargin,
    cmPct,
  }
}

const KPI_CARDS = [
  {
    key: 'treasuryBalance',
    label: 'Total Escrow Held',
    icon: Landmark,
    tone: 'gold',
  },
  {
    key: 'todaySettlements',
    label: "Today's Settlements",
    icon: TrendingUp,
    tone: 'success',
  },
  {
    key: 'pendingApprovals',
    label: 'Pending Approvals',
    icon: Clock,
    tone: 'warning',
  },
  {
    key: 'monthCommission',
    label: 'This Month Revenue',
    icon: BarChart3,
    tone: 'info',
  },
]

function formatToday() {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatValue(key, kpis) {
  if (!kpis) return '—'

  switch (key) {
    case 'treasuryBalance':
      if (!kpis.treasuryConfigured) return '—'
      return formatInr(kpis.treasuryBalance)
    case 'todaySettlements':
      return formatCount(kpis.todaySettlements)
    case 'pendingApprovals':
      return formatCount(kpis.pendingApprovals)
    case 'monthCommission':
      return formatInr(kpis.monthCommission)
    default:
      return '—'
  }
}

function getChip(key, kpis) {
  if (!kpis) {
    return key === 'todaySettlements' ? 'Today · IST' : 'Loading…'
  }

  switch (key) {
    case 'treasuryBalance':
      return kpis.treasuryConfigured ? 'Live' : 'Not configured'
    case 'todaySettlements':
      return 'Today · IST'
    case 'pendingApprovals':
      return (kpis.pendingApprovals || 0) > 0
        ? `${formatCount(kpis.pendingApprovals)} pending`
        : 'None pending'
    case 'monthCommission':
      return formatMonthLabel(kpis.bounds?.month)
    default:
      return ''
  }
}

export default function Dashboard() {
  const user = useAuthStore((s) => s.user)
  const firstName = user?.email?.split('@')[0]?.split(/[._]/)[0] || 'Admin'
  const [kpis, setKpis] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [plMonth, setPlMonth] = useState(getCurrentMonthYear)
  const [plRevenue, setPlRevenue] = useState(0)
  const [plOpex, setPlOpex] = useState(0)
  const [plEbitda, setPlEbitda] = useState(0)
  const [plPat, setPlPat] = useState(0)
  const [plLoading, setPlLoading] = useState(true)
  const [plError, setPlError] = useState('')

  const [utilMonth, setUtilMonth] = useState(getCurrentMonthYear)
  const [utilMachines, setUtilMachines] = useState([])
  const [utilLoading, setUtilLoading] = useState(true)
  const [utilError, setUtilError] = useState('')

  const [ueMonth, setUeMonth] = useState(getCurrentMonthYear)
  const [ueMetrics, setUeMetrics] = useState(null)
  const [ueLoading, setUeLoading] = useState(true)
  const [ueError, setUeError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadKpis() {
      setLoading(true)
      setError('')
      try {
        const data = await apiFetch('/api/admin/dashboard-kpis')
        if (!cancelled) {
          setKpis(data)
        }
      } catch (err) {
        if (cancelled) return
        const message = err.message || 'Failed to load dashboard data'
        if (err.status === 401 || message.toLowerCase().includes('auth')) {
          setError('Session expired. Please login again.')
        } else {
          setError(message)
        }
        setKpis(null)
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadKpis()
    return () => {
      cancelled = true
    }
  }, [])

  const loadPl = useCallback(async (month) => {
    setPlLoading(true)
    setPlError('')
    try {
      const { start, end } = monthBounds(month)

      const [revenueResult, opexResult] = await Promise.all([
        (async () => {
          try {
            const { data, error: revErr } = await supabase
              .from('booking_settlements')
              .select('commission_amount')
              .gte('created_at', start)
              .lt('created_at', end)
            if (revErr) throw revErr
            return (data || []).reduce(
              (sum, row) => sum + (Number(row.commission_amount) || 0),
              0,
            )
          } catch {
            return null
          }
        })(),
        (async () => {
          try {
            const { data, error: opexErr } = await supabase
              .from('finance_opex_entries')
              .select(
                'hetzner_vps, supabase, railway, whatsapp_api, razorpay_fees, salary_engineer, salary_sales, marketing, other',
              )
              .eq('month_year', month)
              .maybeSingle()
            if (opexErr) throw opexErr
            return sumOpexRow(data)
          } catch {
            return null
          }
        })(),
      ])

      if (revenueResult === null || opexResult === null) {
        setPlRevenue(0)
        setPlOpex(0)
        setPlEbitda(0)
        setPlPat(0)
        setPlError('Failed to load P&L data. Please try again.')
        return
      }

      const { ebitda, pat } = calcPlMetrics(revenueResult, opexResult)
      setPlRevenue(revenueResult)
      setPlOpex(opexResult)
      setPlEbitda(ebitda)
      setPlPat(pat)
    } catch {
      setPlRevenue(0)
      setPlOpex(0)
      setPlEbitda(0)
      setPlPat(0)
      setPlError('Failed to load P&L data. Please try again.')
    } finally {
      setPlLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPl(plMonth)
  }, [plMonth, loadPl])

  const loadUtil = useCallback(async (month) => {
    setUtilLoading(true)
    setUtilError('')
    try {
      const { start, end } = monthBounds(month)

      const [machinesResult, billedResult] = await Promise.all([
        (async () => {
          try {
            const { data, error: machinesErr } = await supabase
              .from('machines')
              .select('id, name, machine_type')
              .eq('status', 'active')
            if (machinesErr) throw machinesErr
            return data || []
          } catch {
            return null
          }
        })(),
        (async () => {
          try {
            const { data, error: billedErr } = await supabase
              .from('booking_settlements')
              .select('machine_id, billed_hours')
              .gte('created_at', start)
              .lt('created_at', end)
            if (billedErr) throw billedErr
            return data || []
          } catch {
            return null
          }
        })(),
      ])

      if (machinesResult === null || billedResult === null) {
        setUtilMachines([])
        setUtilError('Failed to load fleet utilization. Please try again.')
        return
      }

      const billedByMachine = new Map()
      for (const row of billedResult) {
        const id = row.machine_id
        if (id == null) continue
        const hours = Number(row.billed_hours) || 0
        billedByMachine.set(id, (billedByMachine.get(id) || 0) + hours)
      }

      const rows = machinesResult.map((machine) => {
        const billedHours = billedByMachine.get(machine.id) || 0
        const utilizationPct =
          AVAILABLE_HOURS_PER_MONTH > 0
            ? (billedHours / AVAILABLE_HOURS_PER_MONTH) * 100
            : 0
        return {
          id: machine.id,
          name: machine.name || '—',
          machine_type: machine.machine_type || '—',
          billedHours,
          availableHours: AVAILABLE_HOURS_PER_MONTH,
          utilizationPct,
        }
      })

      setUtilMachines(rows)
    } catch {
      setUtilMachines([])
      setUtilError('Failed to load fleet utilization. Please try again.')
    } finally {
      setUtilLoading(false)
    }
  }, [])

  useEffect(() => {
    loadUtil(utilMonth)
  }, [utilMonth, loadUtil])

  const utilOverallPct = (() => {
    if (!utilMachines.length) return 0
    const totalBilled = utilMachines.reduce((sum, m) => sum + m.billedHours, 0)
    const capacity = AVAILABLE_HOURS_PER_MONTH * utilMachines.length
    return capacity > 0 ? (totalBilled / capacity) * 100 : 0
  })()

  const loadUe = useCallback(async (month) => {
    setUeLoading(true)
    setUeError('')
    try {
      const { start, end } = monthBounds(month)

      let hasRazorpayFee = true
      let { data, error: ueErr } = await supabase
        .from('booking_settlements')
        .select('commission_amount, gbv, razorpay_fee')
        .gte('created_at', start)
        .lt('created_at', end)

      if (ueErr) {
        hasRazorpayFee = false
        const fallback = await supabase
          .from('booking_settlements')
          .select('commission_amount, gbv')
          .gte('created_at', start)
          .lt('created_at', end)
        if (fallback.error) throw fallback.error
        data = fallback.data
      }

      setUeMetrics(calcUeMetrics(data || [], hasRazorpayFee))
    } catch {
      setUeMetrics(null)
      setUeError('Failed to load unit economics. Please try again.')
    } finally {
      setUeLoading(false)
    }
  }, [])

  useEffect(() => {
    loadUe(ueMonth)
  }, [ueMonth, loadUe])

  return (
    <>
      <section className="overview-hero">
        <div className="overview-hero-glow" aria-hidden />
        <div className="overview-hero-inner">
          <div>
            <h2>Welcome back, {firstName}</h2>
            <p className="overview-hero-date">{formatToday()}</p>
          </div>
          <div className="overview-badge">
            <span className="overview-badge-dot" />
            Admin · Finance Operations
          </div>
        </div>
      </section>

      {error && (
        <div className="dashboard-error" role="alert">
          {error}
        </div>
      )}

      <div className="overview-grid">
        {KPI_CARDS.map(({ key, label, icon: Icon, tone }) => (
          <div key={key} className="kpi-card">
            <div className={`kpi-card-glow kpi-card-glow--${tone}`} aria-hidden />
            <div className="kpi-card-top">
              <div className={`kpi-card-icon kpi-card-icon--${tone}`}>
                <Icon size={22} strokeWidth={1.75} />
              </div>
            </div>
            <div className="kpi-card-value">
              {loading ? '…' : formatValue(key, kpis)}
            </div>
            <div className="kpi-card-label">{label}</div>
            <span className="kpi-card-chip">{getChip(key, loading ? null : kpis)}</span>
          </div>
        ))}
      </div>

      <section className="section-card" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="section-header">
          <h2 className="section-title" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            <TrendingUp size={18} strokeWidth={1.75} color="var(--gold)" />
            Monthly P&L
          </h2>
          <input
            type="month"
            className="filter-bar-input"
            value={plMonth}
            onChange={(e) => setPlMonth(e.target.value)}
            disabled={plLoading}
            aria-label="P&L month"
          />
        </div>

        {plError && (
          <div className="dashboard-error" role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span>{plError}</span>
            <button type="button" className="treasury-retry-btn" onClick={() => loadPl(plMonth)}>
              <RefreshCw size={14} />
              Retry
            </button>
          </div>
        )}

        {plLoading ? (
          <div className="overview-grid" style={{ marginBottom: 0 }}>
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="kpi-card reports-kpi-card reports-kpi-card--skeleton"
                aria-hidden
              />
            ))}
          </div>
        ) : (
          <div className="overview-grid" style={{ marginBottom: 0 }}>
            {[
              {
                key: 'revenue',
                label: 'Platform Revenue',
                value: plRevenue,
                positive: true,
                forceTone: 'success',
              },
              {
                key: 'opex',
                label: 'Total Opex',
                value: plOpex,
                positive: false,
                forceTone: 'danger',
              },
              {
                key: 'ebitda',
                label: 'EBITDA',
                value: plEbitda,
                positive: plEbitda >= 0,
                forceTone: plEbitda >= 0 ? 'success' : 'danger',
              },
              {
                key: 'pat',
                label: 'PAT',
                value: plPat,
                positive: plPat >= 0,
                forceTone: plPat >= 0 ? 'success' : 'danger',
              },
            ].map(({ key, label, value, positive, forceTone }) => {
              const isDanger = forceTone === 'danger'
              const tone = isDanger ? 'warning' : 'success'
              const valueColor = isDanger ? '#f87171' : 'var(--success)'
              return (
                <div key={key} className="kpi-card">
                  <div className={`kpi-card-glow kpi-card-glow--${tone}`} aria-hidden />
                  <div className="kpi-card-top">
                    <div className={`kpi-card-icon kpi-card-icon--${tone}`}>
                      <TrendingUp size={22} strokeWidth={1.75} />
                    </div>
                  </div>
                  <div className="kpi-card-value" style={{ color: valueColor }}>
                    {formatInr(value)}
                  </div>
                  <div className="kpi-card-label">{label}</div>
                  <span
                    className="kpi-card-chip"
                    style={{
                      color: valueColor,
                      background: isDanger
                        ? 'rgba(248, 113, 113, 0.12)'
                        : 'rgba(16, 185, 129, 0.12)',
                    }}
                  >
                    {positive ? 'Positive' : 'Negative'}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="section-card" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="section-header">
          <h2 className="section-title" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
            <Activity size={18} strokeWidth={1.75} color="var(--gold)" />
            Fleet Utilization
          </h2>
          <input
            type="month"
            className="filter-bar-input"
            value={utilMonth}
            onChange={(e) => setUtilMonth(e.target.value)}
            disabled={utilLoading}
            aria-label="Fleet utilization month"
          />
        </div>

        {utilError && (
          <div className="dashboard-error" role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span>{utilError}</span>
            <button type="button" className="treasury-retry-btn" onClick={() => loadUtil(utilMonth)}>
              <RefreshCw size={14} />
              Retry
            </button>
          </div>
        )}

        {utilLoading ? (
          <div className="treasury-table-skeleton" aria-hidden>
            <div className="settlement-row--skeleton" style={{ height: '5rem' }} />
            {[0, 1, 2].map((i) => (
              <div key={i} className="settlement-row--skeleton" />
            ))}
          </div>
        ) : utilMachines.length === 0 && !utilError ? (
          <div className="empty-state">
            <div className="empty-state-icon">🚜</div>
            <p>No active machines</p>
          </div>
        ) : utilMachines.length > 0 ? (
          <>
            <div style={{ marginBottom: 'var(--space-5)' }}>
              <div className="kpi-card-label">Overall fleet utilization</div>
              <div
                className="kpi-card-value"
                style={{ color: utilColor(utilOverallPct) }}
              >
                {formatUtilPct(utilOverallPct)}
              </div>
              <span
                className="kpi-card-chip"
                style={{
                  color: utilColor(utilOverallPct),
                  background:
                    utilTone(utilOverallPct) === 'success'
                      ? 'rgba(16, 185, 129, 0.12)'
                      : utilTone(utilOverallPct) === 'warning'
                        ? 'rgba(245, 158, 11, 0.12)'
                        : 'rgba(248, 113, 113, 0.12)',
                }}
              >
                {utilTone(utilOverallPct) === 'success'
                  ? 'Healthy'
                  : utilTone(utilOverallPct) === 'warning'
                    ? 'Moderate'
                    : 'Low'}
              </span>
            </div>

            <div className="ledger-table-wrap">
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Machine name</th>
                    <th>Type</th>
                    <th>Billed hrs</th>
                    <th>Available hrs</th>
                    <th>Utilization %</th>
                  </tr>
                </thead>
                <tbody>
                  {utilMachines.map((row) => (
                    <tr key={row.id}>
                      <td data-label="Machine name">{row.name}</td>
                      <td data-label="Type">{row.machine_type}</td>
                      <td data-label="Billed hrs">{row.billedHours.toFixed(1)}</td>
                      <td data-label="Available hrs">{row.availableHours}</td>
                      <td data-label="Utilization %">
                        <span
                          className="kpi-card-chip"
                          style={{
                            color: utilColor(row.utilizationPct),
                            background:
                              utilTone(row.utilizationPct) === 'success'
                                ? 'rgba(16, 185, 129, 0.12)'
                                : utilTone(row.utilizationPct) === 'warning'
                                  ? 'rgba(245, 158, 11, 0.12)'
                                  : 'rgba(248, 113, 113, 0.12)',
                          }}
                        >
                          {formatUtilPct(row.utilizationPct)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>

      <section className="section-card" style={{ marginBottom: 'var(--space-6)' }}>
        <div className="section-header">
          <h2 className="section-title" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <BarChart2 size={18} strokeWidth={1.75} color="var(--gold)" />
            Unit Economics
            {!ueLoading && ueMetrics && (
              <span className="kpi-card-chip" style={{ marginTop: 0 }}>
                {formatCount(ueMetrics.bookingCount)} bookings
              </span>
            )}
          </h2>
          <input
            type="month"
            className="filter-bar-input"
            value={ueMonth}
            onChange={(e) => setUeMonth(e.target.value)}
            disabled={ueLoading}
            aria-label="Unit economics month"
          />
        </div>

        {ueError && (
          <div className="dashboard-error" role="alert" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span>{ueError}</span>
            <button type="button" className="treasury-retry-btn" onClick={() => loadUe(ueMonth)}>
              <RefreshCw size={14} />
              Retry
            </button>
          </div>
        )}

        {ueLoading ? (
          <div
            className="overview-grid"
            style={{ marginBottom: 0, gridTemplateColumns: 'repeat(3, 1fr)' }}
          >
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="kpi-card reports-kpi-card reports-kpi-card--skeleton"
                aria-hidden
              />
            ))}
          </div>
        ) : ueMetrics && ueMetrics.bookingCount === 0 && !ueError ? (
          <div className="empty-state">
            <div className="empty-state-icon">📈</div>
            <p>No bookings this month</p>
          </div>
        ) : ueMetrics ? (
          <div
            className="overview-grid"
            style={{ marginBottom: 0, gridTemplateColumns: 'repeat(3, 1fr)' }}
          >
            {[
              {
                key: 'avgGbv',
                label: 'Avg GBV per booking',
                value: formatInr(ueMetrics.avgGbv),
                tone: 'info',
                chip: 'Gross',
                color: undefined,
              },
              {
                key: 'avgCommission',
                label: 'Avg Commission per booking',
                value: formatInr(ueMetrics.avgCommission),
                tone: 'success',
                chip: 'Revenue',
                color: 'var(--success)',
              },
              {
                key: 'avgGateway',
                label: 'Avg Gateway Cost',
                value: formatInr(ueMetrics.avgGateway),
                tone: 'warning',
                chip: 'Cost',
                color: '#f87171',
              },
              {
                key: 'avgInfra',
                label: 'Avg Infra Cost',
                value: formatInr(ueMetrics.avgInfra),
                tone: 'warning',
                chip: 'Fixed ₹3,000',
                color: '#f87171',
              },
              {
                key: 'cm',
                label: 'Contribution Margin',
                value: formatInr(ueMetrics.contributionMargin),
                tone: ueMetrics.contributionMargin >= 0 ? 'success' : 'warning',
                chip: ueMetrics.contributionMargin >= 0 ? 'Positive' : 'Negative',
                color:
                  ueMetrics.contributionMargin >= 0 ? 'var(--success)' : '#f87171',
              },
              {
                key: 'cmPct',
                label: 'CM %',
                value: `${ueMetrics.cmPct.toFixed(1)}%`,
                tone:
                  cmTone(ueMetrics.cmPct) === 'danger'
                    ? 'warning'
                    : cmTone(ueMetrics.cmPct),
                chip:
                  cmTone(ueMetrics.cmPct) === 'success'
                    ? 'Strong'
                    : cmTone(ueMetrics.cmPct) === 'warning'
                      ? 'Fair'
                      : 'Weak',
                color: cmColor(ueMetrics.cmPct),
              },
            ].map(({ key, label, value, tone, chip, color }) => (
              <div key={key} className="kpi-card">
                <div className={`kpi-card-glow kpi-card-glow--${tone}`} aria-hidden />
                <div className="kpi-card-top">
                  <div className={`kpi-card-icon kpi-card-icon--${tone}`}>
                    <BarChart2 size={22} strokeWidth={1.75} />
                  </div>
                </div>
                <div className="kpi-card-value" style={color ? { color } : undefined}>
                  {value}
                </div>
                <div className="kpi-card-label">{label}</div>
                <span
                  className="kpi-card-chip"
                  style={
                    color
                      ? {
                          color,
                          background:
                            color === '#f87171'
                              ? 'rgba(248, 113, 113, 0.12)'
                              : color === 'var(--warning)'
                                ? 'rgba(245, 158, 11, 0.12)'
                                : 'rgba(16, 185, 129, 0.12)',
                        }
                      : undefined
                  }
                >
                  {chip}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="section-card">
        <div className="section-header">
          <h2 className="section-title">Recent Activity</h2>
          <span className="section-live">
            <span className="section-live-dot" />
            Monitoring
          </span>
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">📊</div>
          <p>
            No recent activity yet. Settlements, approvals, and treasury
            movements will stream here in real time.
          </p>
        </div>
      </section>
    </>
  )
}
