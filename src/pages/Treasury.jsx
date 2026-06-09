import { useCallback, useEffect, useState } from 'react'
import { Landmark, Loader2, RefreshCw, ShieldCheck, Wallet } from 'lucide-react'
import {
  fetchPendingSettlements,
  fetchTreasury,
  retryPendingSettlement,
} from '../services/machineosApi.js'
import { formatCount, formatDateTime, formatInr } from '../lib/format.js'

function getLoadErrorMessage(err) {
  if (err?.status === 401) return 'Session expired. Please login again.'
  return err?.message || 'Failed to load treasury data'
}

function ReconStatusPill({ status }) {
  const tone = status === 'ok' ? 'ok' : status === 'mismatch' ? 'mismatch' : 'error'
  const label = status === 'ok' ? 'All OK' : status === 'mismatch' ? 'Mismatch' : 'Error'
  return <span className={`status-pill status-pill--${tone}`}>{label}</span>
}

export default function Treasury() {
  const [treasury, setTreasury] = useState(null)
  const [settlements, setSettlements] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [rowErrors, setRowErrors] = useState({})
  const [successMessage, setSuccessMessage] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setSuccessMessage('')
    setRowErrors({})

    try {
      const [treasuryData, settlementData] = await Promise.all([
        fetchTreasury(),
        fetchPendingSettlements('pending_transfer'),
      ])
      setTreasury(treasuryData)
      setSettlements(settlementData.items || [])
    } catch (err) {
      setTreasury(null)
      setSettlements([])
      setError(getLoadErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleTransfer(row) {
    const ownerName = row.owner?.name || 'owner'
    const amount = formatInr(row.net_owner_amount)
    const confirmed = window.confirm(`Transfer ${amount} to ${ownerName}?`)
    if (!confirmed) return

    setBusyId(row.id)
    setSuccessMessage('')
    setRowErrors((prev) => {
      const next = { ...prev }
      delete next[row.id]
      return next
    })

    try {
      const result = await retryPendingSettlement(row.id)
      if (result.duplicate) {
        setSuccessMessage('Already settled.')
      } else {
        setSuccessMessage(
          `Transferred ${formatInr(result.settlement?.net_owner_amount || row.net_owner_amount)} to ${ownerName}.`,
        )
      }
      await load()
    } catch (err) {
      setRowErrors((prev) => ({
        ...prev,
        [row.id]: err.message || 'Transfer failed — check treasury balance.',
      }))
    } finally {
      setBusyId(null)
    }
  }

  const recon = treasury?.latestReconciliation
  const walletsChecked = (recon?.client_wallets_checked || 0) + (recon?.owner_wallets_checked || 0)

  return (
    <div className="treasury-page">
      {error && (
        <div className="dashboard-error treasury-banner" role="alert">
          <span>{error}</span>
          <button type="button" className="treasury-retry-btn" onClick={load}>
            <RefreshCw size={14} />
            Retry
          </button>
        </div>
      )}

      {successMessage && (
        <div className="treasury-success treasury-banner" role="status">
          {successMessage}
        </div>
      )}

      <section className="treasury-grid">
        <div className="treasury-balance-card">
          <div className="kpi-card-glow kpi-card-glow--gold" aria-hidden />
          <div className="treasury-balance-header">
            <div className="kpi-card-icon kpi-card-icon--gold">
              <Landmark size={22} strokeWidth={1.75} />
            </div>
            <div className="treasury-balance-badges">
              {loading ? (
                <span className="kpi-card-chip">Loading…</span>
              ) : treasury?.isDedicatedEscrow ? (
                <span className="treasury-badge treasury-badge--dedicated">
                  <ShieldCheck size={12} />
                  DEDICATED
                </span>
              ) : (
                <span className="treasury-badge treasury-badge--warn">CHECK FLAG</span>
              )}
              {!loading && treasury && (
                <span className="kpi-card-chip">
                  {formatCount(treasury.pendingSettlementCount || 0)} pending transfers
                </span>
              )}
            </div>
          </div>

          <div className="treasury-balance-stats">
            <div className="treasury-stat">
              <div className="kpi-card-label">Treasury Balance</div>
              <div className="kpi-card-value">
                {loading ? '…' : formatInr(treasury?.balance)}
              </div>
            </div>
            <div className="treasury-stat">
              <div className="kpi-card-label">Active Escrow Held</div>
              <div className="kpi-card-value treasury-stat-value--muted">
                {loading ? '…' : formatInr(treasury?.activeEscrowHeld)}
              </div>
            </div>
          </div>

          <p className="treasury-meta">
            {loading ? (
              'Loading treasury…'
            ) : (
              <>
                {treasury?.adminName || 'Treasury account'}
                {treasury?.updatedAt && (
                  <> · Updated {formatDateTime(treasury.updatedAt)}</>
                )}
              </>
            )}
          </p>
        </div>

        <div className="recon-status-card">
          <div className="kpi-card-glow kpi-card-glow--info" aria-hidden />
          <div className="recon-status-header">
            <div className="kpi-card-icon kpi-card-icon--info">
              <Wallet size={20} strokeWidth={1.75} />
            </div>
            <h2 className="section-title">Reconciliation</h2>
          </div>

          {loading ? (
            <p className="treasury-skeleton-text">…</p>
          ) : !recon ? (
            <p className="treasury-empty-inline">No recon run yet</p>
          ) : (
            <>
              <div className="recon-status-row">
                <ReconStatusPill status={recon.status} />
                <span className="treasury-meta">{formatDateTime(recon.run_at)}</span>
              </div>
              <div className="recon-metrics">
                <div>
                  <span className="kpi-card-label">Wallets checked</span>
                  <strong>{formatCount(walletsChecked)}</strong>
                </div>
                <div>
                  <span className="kpi-card-label">Mismatches</span>
                  <strong className={recon.mismatch_count > 0 ? 'treasury-text-warn' : ''}>
                    {formatCount(recon.mismatch_count || 0)}
                  </strong>
                </div>
              </div>
              {recon.status !== 'ok' && recon.treasury_delta != null && (
                <p className="treasury-meta treasury-text-warn">
                  Treasury delta {formatInr(recon.treasury_delta)}
                </p>
              )}
            </>
          )}
        </div>
      </section>

      <section className="section-card treasury-settlements">
        <div className="section-header">
          <h2 className="section-title">Pending Settlements</h2>
          <span className="kpi-card-chip">
            {loading ? '…' : `${formatCount(settlements.length)} queued`}
          </span>
        </div>

        {loading ? (
          <div className="treasury-table-skeleton">
            {[1, 2, 3].map((n) => (
              <div key={n} className="settlement-row settlement-row--skeleton" />
            ))}
          </div>
        ) : settlements.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">✓</div>
            <p>No pending treasury → owner transfers. All settlements are up to date.</p>
          </div>
        ) : (
          <div className="settlement-table-wrap">
            <table className="settlement-table">
              <thead>
                <tr>
                  <th>Booking Ref</th>
                  <th>Owner</th>
                  <th>Net Amount</th>
                  <th>Date</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {settlements.map((row) => (
                  <tr key={row.id} className="settlement-row">
                    <td data-label="Booking Ref">
                      <span className="settlement-ref">{row.booking_ref}</span>
                    </td>
                    <td data-label="Owner">{row.owner?.name || row.owner_id}</td>
                    <td data-label="Net Amount">{formatInr(row.net_owner_amount)}</td>
                    <td data-label="Date">{formatDateTime(row.created_at)}</td>
                    <td data-label="Action">
                      <button
                        type="button"
                        className="settlement-transfer-btn"
                        disabled={busyId === row.id}
                        onClick={() => handleTransfer(row)}
                      >
                        {busyId === row.id ? (
                          <>
                            <Loader2 size={14} className="treasury-spin" />
                            Transferring…
                          </>
                        ) : (
                          'Transfer'
                        )}
                      </button>
                      {rowErrors[row.id] && (
                        <p className="settlement-row-error" role="alert">
                          {rowErrors[row.id]}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
