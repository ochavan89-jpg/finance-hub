import { useAuthStore } from '../store/authStore.js'
import {
  BarChart3,
  Clock,
  Landmark,
  TrendingUp,
} from 'lucide-react'

const KPI_CARDS = [
  {
    label: 'Total Escrow Held',
    icon: Landmark,
    tone: 'gold',
    chip: 'Awaiting data',
  },
  {
    label: "Today's Settlements",
    icon: TrendingUp,
    tone: 'success',
    chip: 'Live sync',
  },
  {
    label: 'Pending Approvals',
    icon: Clock,
    tone: 'warning',
    chip: 'Action needed',
  },
  {
    label: 'This Month Revenue',
    icon: BarChart3,
    tone: 'info',
    chip: 'Month to date',
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

export default function Dashboard() {
  const user = useAuthStore((s) => s.user)
  const firstName = user?.email?.split('@')[0]?.split(/[._]/)[0] || 'Admin'

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

      <div className="overview-grid">
        {KPI_CARDS.map(({ label, icon: Icon, tone, chip }) => (
          <div key={label} className="kpi-card">
            <div className={`kpi-card-glow kpi-card-glow--${tone}`} aria-hidden />
            <div className="kpi-card-top">
              <div className={`kpi-card-icon kpi-card-icon--${tone}`}>
                <Icon size={22} strokeWidth={1.75} />
              </div>
            </div>
            <div className="kpi-card-value">—</div>
            <div className="kpi-card-label">{label}</div>
            <span className="kpi-card-chip">{chip}</span>
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
