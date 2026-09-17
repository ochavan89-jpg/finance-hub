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
import { supabase } from '../lib/supabase.js'
import {
  confirm2faSetup,
  disable2fa,
  fetch2faStatus,
  fetchClientIpInfo,
  start2faSetup,
} from '../services/finance2faApi.js'
import { fetchTreasury } from '../services/machineosApi.js'
import { useAuthStore } from '../store/authStore.js'

function getErrorMessage(err) {
  if (err?.status === 401 || err?.message === 'auth_required') {
    return 'Session expired. Please login again.'
  }
  return err?.message || 'Failed to load configuration'
}

function getCurrentMonthYear() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

const EMPTY_OPEX = {
  hetzner_vps: '',
  supabase: '',
  railway: '',
  whatsapp_api: '',
  razorpay_fees: '',
  salary_engineer: '',
  salary_sales: '',
  marketing: '',
  other: '',
  notes: '',
}

const OPEX_FIELDS = [
  { key: 'hetzner_vps', label: 'Hetzner VPS' },
  { key: 'supabase', label: 'Supabase' },
  { key: 'railway', label: 'Railway' },
  { key: 'whatsapp_api', label: 'WhatsApp API' },
  { key: 'razorpay_fees', label: 'Razorpay Fees' },
  { key: 'salary_engineer', label: 'Engineer Salary' },
  { key: 'salary_sales', label: 'Sales Salary' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'other', label: 'Other' },
]

function rowToOpexData(row) {
  if (!row) return { ...EMPTY_OPEX }
  return {
    hetzner_vps: row.hetzner_vps ?? '',
    supabase: row.supabase ?? '',
    railway: row.railway ?? '',
    whatsapp_api: row.whatsapp_api ?? '',
    razorpay_fees: row.razorpay_fees ?? '',
    salary_engineer: row.salary_engineer ?? '',
    salary_sales: row.salary_sales ?? '',
    marketing: row.marketing ?? '',
    other: row.other ?? '',
    notes: row.notes ?? '',
  }
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
  const [clientIp, setClientIp] = useState('—')
  const [twoFa, setTwoFa] = useState({ enabled: false, trustedIp: false, loading: true })
  const [twoFaSetup, setTwoFaSetup] = useState(null)
  const [twoFaCode, setTwoFaCode] = useState('')
  const [twoFaBusy, setTwoFaBusy] = useState(false)
  const [twoFaError, setTwoFaError] = useState('')
  const [twoFaSuccess, setTwoFaSuccess] = useState('')

  const [opexMonth, setOpexMonth] = useState(getCurrentMonthYear)
  const [opexData, setOpexData] = useState(() => ({ ...EMPTY_OPEX }))
  const [opexLoading, setOpexLoading] = useState(false)
  const [opexSaving, setOpexSaving] = useState(false)
  const [opexSuccess, setOpexSuccess] = useState('')
  const [opexError, setOpexError] = useState('')

  const opexTotal = OPEX_FIELDS.reduce(
    (sum, { key }) => sum + (Number(opexData[key]) || 0),
    0,
  )

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

  const load2fa = useCallback(async () => {
    if (!token) return
    setTwoFa((prev) => ({ ...prev, loading: true }))
    setTwoFaError('')
    try {
      const [ipInfo, status] = await Promise.all([fetchClientIpInfo(), fetch2faStatus(token)])
      setClientIp(ipInfo.ip || '—')
      setTwoFa({ enabled: status.enabled, trustedIp: status.trustedIp, loading: false })
    } catch (err) {
      setTwoFa({ enabled: false, trustedIp: false, loading: false })
      setTwoFaError(getErrorMessage(err))
    }
  }, [token])

  useEffect(() => {
    load2fa()
  }, [load2fa])

  async function handleStart2fa() {
    if (!token) return
    setTwoFaBusy(true)
    setTwoFaError('')
    setTwoFaSuccess('')
    try {
      const data = await start2faSetup(token)
      setTwoFaSetup(data)
      setTwoFaCode('')
    } catch (err) {
      setTwoFaError(getErrorMessage(err))
    } finally {
      setTwoFaBusy(false)
    }
  }

  async function handleConfirm2fa(e) {
    e.preventDefault()
    if (!token) return
    setTwoFaBusy(true)
    setTwoFaError('')
    setTwoFaSuccess('')
    try {
      await confirm2faSetup(token, twoFaCode)
      setTwoFaSetup(null)
      setTwoFaCode('')
      setTwoFaSuccess('2FA enabled. Mobile login will now require authenticator code.')
      await load2fa()
    } catch (err) {
      setTwoFaError(getErrorMessage(err))
    } finally {
      setTwoFaBusy(false)
    }
  }

  async function handleDisable2fa(e) {
    e.preventDefault()
    if (!token) return
    setTwoFaBusy(true)
    setTwoFaError('')
    setTwoFaSuccess('')
    try {
      await disable2fa(token, twoFaCode)
      setTwoFaCode('')
      setTwoFaSuccess('2FA disabled.')
      await load2fa()
    } catch (err) {
      setTwoFaError(getErrorMessage(err))
    } finally {
      setTwoFaBusy(false)
    }
  }

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

  const loadOpex = useCallback(async (month) => {
    setOpexLoading(true)
    setOpexError('')
    setOpexSuccess('')
    try {
      const { data, error } = await supabase
        .from('finance_opex_entries')
        .select(
          'month_year, hetzner_vps, supabase, railway, whatsapp_api, razorpay_fees, salary_engineer, salary_sales, marketing, other, notes',
        )
        .eq('month_year', month)
        .maybeSingle()
      if (error) throw error
      setOpexData(rowToOpexData(data))
    } catch {
      setOpexData({ ...EMPTY_OPEX })
    } finally {
      setOpexLoading(false)
    }
  }, [])

  useEffect(() => {
    loadOpex(opexMonth)
  }, [opexMonth, loadOpex])

  function handleOpexFieldChange(key, value) {
    setOpexData((prev) => ({ ...prev, [key]: value }))
    setOpexSuccess('')
    setOpexError('')
  }

  async function handleSaveOpex(e) {
    e.preventDefault()
    setOpexSaving(true)
    setOpexError('')
    setOpexSuccess('')
    try {
      const payload = {
        month_year: opexMonth,
        hetzner_vps: Number(opexData.hetzner_vps) || 0,
        supabase: Number(opexData.supabase) || 0,
        railway: Number(opexData.railway) || 0,
        whatsapp_api: Number(opexData.whatsapp_api) || 0,
        razorpay_fees: Number(opexData.razorpay_fees) || 0,
        salary_engineer: Number(opexData.salary_engineer) || 0,
        salary_sales: Number(opexData.salary_sales) || 0,
        marketing: Number(opexData.marketing) || 0,
        other: Number(opexData.other) || 0,
        notes: opexData.notes?.trim() || null,
      }
      const { error } = await supabase
        .from('finance_opex_entries')
        .upsert(payload, { onConflict: 'month_year' })
      if (error) throw error
      setOpexSuccess(`Opex saved for ${opexMonth}`)
    } catch {
      setOpexError('Failed to save. Please try again.')
    } finally {
      setOpexSaving(false)
    }
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
            <p className="settings-footnote">Platform rates are configured via Railway environment variables (DE_COMMISSION_PCT, DE_TDS_PCT, DE_GST_TCS_PCT).</p>

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

        <section className="section-card settings-card">
          <div className="settings-section-title">
            <Shield size={18} strokeWidth={1.75} />
            <h2>Two-Factor Auth (Mobile)</h2>
          </div>

          <p className="settings-2fa-intro">
            WiFi IP <strong>43.231.135.200</strong> वरून login केल्यास 2FA लागत नाही. Mobile / बाहेर
            असल्यास authenticator code लागेल.
          </p>

          {twoFaError && (
            <div className="dashboard-error settings-section-msg" role="alert">
              {twoFaError}
            </div>
          )}
          {twoFaSuccess && (
            <div className="treasury-success settings-section-msg" role="status">
              {twoFaSuccess}
            </div>
          )}

          <div className="settings-rows">
            <div className="settings-row">
              <span className="settings-label">Your current IP</span>
              <span className="settings-value">{clientIp}</span>
            </div>
            <div className="settings-row">
              <span className="settings-label">Trusted WiFi</span>
              <span className="settings-value">
                {twoFa.loading ? (
                  'Loading…'
                ) : twoFa.trustedIp ? (
                  <span className="settings-status settings-status--ok">
                    <CheckCircle2 size={15} />
                    Yes — 2FA skip
                  </span>
                ) : (
                  <span className="settings-status settings-status--warn">
                    <AlertTriangle size={15} />
                    No — 2FA required
                  </span>
                )}
              </span>
            </div>
            <div className="settings-row">
              <span className="settings-label">2FA status</span>
              <span className="settings-value">
                {twoFa.loading ? (
                  'Loading…'
                ) : twoFa.enabled ? (
                  <span className="settings-status settings-status--ok">
                    <CheckCircle2 size={15} />
                    Enabled
                  </span>
                ) : (
                  <span className="settings-status settings-status--warn">Not set up</span>
                )}
              </span>
            </div>
          </div>

          {!twoFa.enabled && !twoFaSetup && (
            <button
              type="button"
              className="settings-2fa-btn"
              onClick={handleStart2fa}
              disabled={twoFaBusy || twoFa.loading}
            >
              {twoFaBusy ? (
                <>
                  <Loader2 size={16} className="treasury-spin" />
                  Starting…
                </>
              ) : (
                'Set up Google Authenticator'
              )}
            </button>
          )}

          {twoFaSetup && (
            <form className="settings-2fa-form" onSubmit={handleConfirm2fa}>
              <p className="settings-2fa-step">
                1. Google Authenticator उघडा → QR scan करा (किंवा key manually add करा)
              </p>
              {twoFaSetup.qrDataUrl && (
                <img
                  src={twoFaSetup.qrDataUrl}
                  alt="2FA QR code"
                  className="settings-2fa-qr"
                />
              )}
              {twoFaSetup.manualKey && (
                <p className="settings-2fa-key">
                  Manual key: <code>{twoFaSetup.manualKey}</code>
                </p>
              )}
              <p className="settings-2fa-step">2. App मधला 6-digit code खाली टाका</p>
              <input
                type="text"
                inputMode="numeric"
                className="settings-2fa-input"
                placeholder="000000"
                value={twoFaCode}
                onChange={(e) => setTwoFaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                required
                disabled={twoFaBusy}
              />
              <button
                type="submit"
                className="settings-2fa-btn"
                disabled={twoFaBusy || twoFaCode.length < 6}
              >
                {twoFaBusy ? 'Verifying…' : 'Enable 2FA'}
              </button>
            </form>
          )}

          {twoFa.enabled && !twoFaSetup && (
            <form className="settings-2fa-form" onSubmit={handleDisable2fa}>
              <p className="settings-2fa-step">Disable करण्यासाठी authenticator code टाका</p>
              <input
                type="text"
                inputMode="numeric"
                className="settings-2fa-input"
                placeholder="000000"
                value={twoFaCode}
                onChange={(e) => setTwoFaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                required
                disabled={twoFaBusy}
              />
              <button
                type="submit"
                className="settings-2fa-btn settings-2fa-btn--danger"
                disabled={twoFaBusy || twoFaCode.length < 6}
              >
                {twoFaBusy ? 'Disabling…' : 'Disable 2FA'}
              </button>
            </form>
          )}
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

        <section className="section-card settings-card settings-card--session">
          <div className="settings-section-title">
            <SettingsIcon size={18} strokeWidth={1.75} />
            <h2>Monthly Operating Expenses</h2>
          </div>

          {opexError && (
            <div className="dashboard-error settings-section-msg" role="alert">
              {opexError}
            </div>
          )}
          {opexSuccess && (
            <div className="treasury-success settings-section-msg" role="status">
              {opexSuccess}
            </div>
          )}

          <form className="settings-2fa-form" onSubmit={handleSaveOpex}>
            <div className="settings-rows">
              <div className="settings-row">
                <span className="settings-label">Month</span>
                <span className="settings-value">
                  <input
                    type="month"
                    className="filter-bar-input"
                    value={opexMonth}
                    onChange={(e) => setOpexMonth(e.target.value)}
                    disabled={opexLoading || opexSaving}
                    required
                  />
                </span>
              </div>

              {OPEX_FIELDS.map(({ key, label }) => (
                <div className="settings-row" key={key}>
                  <span className="settings-label">{label}</span>
                  <span className="settings-value">
                    ₹{' '}
                    <input
                      type="number"
                      className="filter-bar-input"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={opexData[key]}
                      onChange={(e) => handleOpexFieldChange(key, e.target.value)}
                      disabled={opexLoading || opexSaving}
                      placeholder="0"
                      style={{ maxWidth: '11rem', textAlign: 'right' }}
                    />
                  </span>
                </div>
              ))}

              <div className="settings-row settings-row--stacked">
                <span className="settings-label">Notes</span>
                <textarea
                  className="credit-reason-textarea"
                  rows={3}
                  placeholder="Optional notes"
                  value={opexData.notes}
                  onChange={(e) => handleOpexFieldChange('notes', e.target.value)}
                  disabled={opexLoading || opexSaving}
                />
              </div>

              <div className="settings-row">
                <span className="settings-label">Total Opex</span>
                <span className="settings-value settings-value--gold">
                  {opexLoading ? (
                    <Loader2 size={16} className="treasury-spin" aria-label="Loading" />
                  ) : (
                    formatInr(opexTotal)
                  )}
                </span>
              </div>
            </div>

            <button
              type="submit"
              className="settings-2fa-btn"
              disabled={opexLoading || opexSaving}
            >
              {opexSaving ? (
                <>
                  <Loader2 size={16} className="treasury-spin" />
                  Saving…
                </>
              ) : (
                'Save'
              )}
            </button>
          </form>
        </section>
      </div>
    </div>
  )
}
