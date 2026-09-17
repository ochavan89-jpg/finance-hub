import { useCallback, useEffect, useState } from 'react'
import { useAuthStore } from '../store/authStore.js'
import { apiFetch } from '../services/machineosApi.js'
import { formatCount, formatInr, formatMonthLabel } from '../lib/format.js'
import { supabase } from '../lib/supabase.js'
import {
  BarChart3,
  Clock,
  Landmark,
  RefreshCw,
  TrendingUp,
} from 'lucide-react'

const PL_DEPRECIATION = 5000
const PL_TAX_RATE = 0.25

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
