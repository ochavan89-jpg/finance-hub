import { useEffect, useState } from 'react'
import { useAuthStore } from '../store/authStore.js'
import { apiFetch } from '../services/machineosApi.js'
import { formatCount, formatInr, formatMonthLabel } from '../lib/format.js'
import {
  BarChart3,
  Clock,
  Landmark,
  TrendingUp,
} from 'lucide-react'

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
