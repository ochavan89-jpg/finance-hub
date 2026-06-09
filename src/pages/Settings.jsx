import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  LogOut,
  RefreshCw,
  Settings as SettingsIcon,
  Shield,
  User,
} from 'lucide-react'
import { formatInr } from '../lib/format.js'
import { getSessionStarted, getTokenExpiryLabel } from '../lib/session.js'
import { fetchTreasury } from '../services/machineosApi.js'
import { useAuthStore } from '../store/authStore.js'

const PLATFORM_RATES = [
  {
    label: 'Commission Rate',
    value: '15%',
    footnote: 'Server default · DE_COMMISSION_PCT',
  },
  {
    label: 'TDS Rate',
    value: '2% u/s 194C',
    footnote: 'Server default · DE_TDS_PCT',
  },
  {
    label: 'GST TCS',
    value: '1%',
    footnote: 'Server default · DE_GST_TCS_PCT',
  },
]

function getErrorMessage(err) {
  if (err?.status === 401 || err?.message === 'auth_required') {
    return 'Session expired. Please login again.'
  }
  return err?.message || 'Failed to load configuration'
}

export default function Settings() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const token = useAuthStore((s) => s.token)
  const signOut = useAuthStore((s) => s.signOut)

  const [treasury, setTreasury] = useState(null)
  const [treasuryConfigured, setTreasuryConfigured] = useState(null)
  const [treasuryLoading, setTreasuryLoading] = useState(true)
  const [treasuryError, setTreasuryError] = useState('')
  const [expiryLabel, setExpiryLabel] = useState('—')
  const [loggingOut, setLoggingOut] = useState(false)

  const loadTreasury = useCallback(async () => {
    setTreasuryLoading(true)
    setTreasuryError('')
    try {
      const data = await fetchTreasury()
      setTreasury(data)
      setTreasuryConfigured(true)
    } catch (err) {
      setTreasury(null)
      if (err?.status === 503) {
        setTreasuryConfigured(false)
      } else {
        setTreasuryConfigured(null)
        setTreasuryError(getErrorMessage(err))
      }
    } finally {
      setTreasuryLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTreasury()
  }, [loadTreasury])

  useEffect(() => {
    function refreshExpiry() {
      setExpiryLabel(getTokenExpiryLabel(token))
    }
    refreshExpiry()
    const timer = setInterval(refreshExpiry, 30000)
    return () => clearInterval(timer)
  }, [token])

  async function handleLogout() {
    setLoggingOut(true)
    await signOut()
    navigate('/')
  }

  const dualThreshold = treasury?.dualApprovalMinInr

  return (
    <div className="settings-page">
      <div className="settings-grid">
        <section className="section-card settings-card">
          <div className="settings-section-title">
            <User size={18} strokeWidth={1.75} />
            <h2>Admin Profile</h2>
          </div>
          <div className="settings-rows">
            <div className="settings-row">
              <span className="settings-label">Name</span>
              <span className="settings-value">{user?.name || '—'}</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">Email</span>
              <span className="settings-value">{user?.email || '—'}</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">Role</span>
              <span className="settings-badge">Admin</span>
            </div>
            {user?.phone && (
              <div className="settings-row">
                <span className="settings-label">Phone</span>
                <span className="settings-value">{user.phone}</span>
              </div>
            )}
          </div>
        </section>

        <section className="section-card settings-card">
          <div className="settings-section-title">
            <SettingsIcon size={18} strokeWidth={1.75} />
            <h2>System Configuration</h2>
          </div>

          {treasuryError && (
            <div className="dashboard-error settings-section-msg" role="alert">
              <span>{treasuryError}</span>
              <button type="button" className="treasury-retry-btn" onClick={loadTreasury}>
                <RefreshCw size={14} />
                Retry
              </button>
            </div>
          )}

          <div className="settings-rows">
            {PLATFORM_RATES.map(({ label, value, footnote }) => (
              <div key={label} className="settings-row settings-row--stacked">
                <div className="settings-row-main">
                  <span className="settings-label">{label}</span>
                  <span className="settings-value">{value}</span>
                </div>
                <p className="settings-footnote">{footnote}</p>
              </div>
            ))}

            <div className="settings-row settings-row--stacked">
              <div className="settings-row-main">
                <span className="settings-label">Dual Approval Threshold</span>
                <span className="settings-value settings-value--gold">
                  {treasuryLoading ? (
                    <Loader2 size={16} className="treasury-spin" aria-label="Loading" />
                  ) : treasuryConfigured && dualThreshold != null ? (
                    formatInr(dualThreshold)
                  ) : (
                    '—'
                  )}
                </span>
              </div>
            </div>

            <div className="settings-row">
              <span className="settings-label">Treasury</span>
              <span className="settings-value">
                {treasuryLoading ? (
                  <span className="settings-status settings-status--loading">Loading…</span>
                ) : treasuryConfigured ? (
                  <span className="settings-status settings-status--ok">
                    <CheckCircle2 size={15} />
                    Configured
                  </span>
                ) : (
                  <span className="settings-status settings-status--warn">
                    <AlertTriangle size={15} />
                    Not configured
                  </span>
                )}
              </span>
            </div>
          </div>
        </section>

        <section className="section-card settings-card settings-card--session">
          <div className="settings-section-title">
            <Shield size={18} strokeWidth={1.75} />
            <h2>Session</h2>
          </div>
          <div className="settings-rows">
            <div className="settings-row">
              <span className="settings-label">Signed in as</span>
              <span className="settings-value">{user?.email || '—'}</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">Session started</span>
              <span className="settings-value">{getSessionStarted(token)}</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">Token expires</span>
              <span className="settings-value session-expiry">{expiryLabel}</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">Role</span>
              <span className="settings-value">Admin</span>
            </div>
          </div>
          <button
            type="button"
            className="settings-logout-btn"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            <LogOut size={16} />
            {loggingOut ? 'Signing out…' : 'Logout'}
          </button>
        </section>
      </div>
    </div>
  )
}
