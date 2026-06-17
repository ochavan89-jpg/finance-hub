import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import {
  approveBankTopup,
  approveDualApproval,
  approveWithdrawRequest,
  fetchBankTopups,
  fetchDualApprovals,
  fetchWithdrawRequests,
  fetchWithdrawUtrProof,
  rejectBankTopup,
  rejectDualApproval,
  rejectWithdrawRequest,
} from '../services/machineosApi.js'
import { formatDateTime, formatInr } from '../lib/format.js'

const ACTION_LABELS = {
  client_refund: 'Client Refund',
  owner_payout: 'Owner Payout',
  bank_topup: 'Bank Top-up',
  owner_withdraw: 'Owner Withdraw',
  admin_wallet_topup: 'Admin Wallet Credit',
}

const ACTION_CHIP_CLASS = {
  client_refund: 'action-chip--refund',
  owner_payout: 'action-chip--payout',
  bank_topup: 'action-chip--topup',
  owner_withdraw: 'action-chip--withdraw',
}

function shortId(id) {
  if (!id) return '—'
  return `${id.slice(0, 8)}…`
}

function getErrorMessage(err) {
  if (err?.status === 401) return 'Session expired. Please login again.'
  if (err?.status === 403) return 'Different admin must approve (maker-checker).'
  return err?.message || 'Request failed'
}

function rowKey(section, id) {
  return `${section}-${id}`
}

export default function Approvals() {
  const [dualItems, setDualItems] = useState([])
  const [bankItems, setBankItems] = useState([])
  const [withdrawItems, setWithdrawItems] = useState([])
  const [threshold, setThreshold] = useState(10000)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [rowErrors, setRowErrors] = useState({})
  const [sectionSuccess, setSectionSuccess] = useState({ dual: '', bank: '', withdraw: '' })
  const [withdrawForms, setWithdrawForms] = useState({})

  const clearRowError = (key) => {
    setRowErrors((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    setSectionSuccess({ dual: '', bank: '', withdraw: '' })
    setRowErrors({})

    try {
      const [dualRes, bankRes, withdrawRes] = await Promise.all([
        fetchDualApprovals('pending_second_approval'),
        fetchBankTopups('pending'),
        fetchWithdrawRequests('pending'),
      ])
      setDualItems(dualRes.items || [])
      setThreshold(dualRes.thresholdInr || 10000)
      setBankItems(bankRes.items || [])
      setWithdrawItems(withdrawRes.items || [])
    } catch (err) {
      setDualItems([])
      setBankItems([])
      setWithdrawItems([])
      setLoadError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function updateWithdrawForm(id, patch) {
    setWithdrawForms((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), ...patch } }))
  }

  async function handleDualApprove(row) {
    const label = ACTION_LABELS[row.action_type] || row.action_type
    const confirmed = window.confirm(
      `Execute ${formatInr(row.amount)} ${label} as second approver?`,
    )
    if (!confirmed) return

    const key = rowKey('dual', row.id)
    setBusyId(row.id)
    clearRowError(key)
    setSectionSuccess((s) => ({ ...s, dual: '' }))

    try {
      await approveDualApproval(row.id, '')
      setSectionSuccess((s) => ({ ...s, dual: 'Approved and executed by second admin.' }))
      await load()
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [key]: getErrorMessage(err) }))
    } finally {
      setBusyId(null)
    }
  }

  async function handleDualReject(row) {
    const note = window.prompt('Rejection reason (optional):')
    if (note === null) return

    const key = rowKey('dual', row.id)
    setBusyId(row.id)
    clearRowError(key)
    setSectionSuccess((s) => ({ ...s, dual: '' }))

    try {
      await rejectDualApproval(row.id, note)
      setSectionSuccess((s) => ({ ...s, dual: 'Maker-checker request rejected.' }))
      await load()
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [key]: getErrorMessage(err) }))
    } finally {
      setBusyId(null)
    }
  }

  async function handleBankApprove(row) {
    const confirmed = window.confirm(`Credit ${formatInr(row.amount)} to wallet?`)
    if (!confirmed) return

    const key = rowKey('bank', row.id)
    setBusyId(row.id)
    clearRowError(key)
    setSectionSuccess((s) => ({ ...s, bank: '' }))

    try {
      const result = await approveBankTopup(row.id, '')
      if (result.pendingSecondApproval) {
        setSectionSuccess((s) => ({ ...s, bank: 'Sent to dual approvals (maker-checker).' }))
      } else {
        setSectionSuccess((s) => ({ ...s, bank: `Wallet credited ${formatInr(row.amount)}.` }))
      }
      await load()
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [key]: getErrorMessage(err) }))
    } finally {
      setBusyId(null)
    }
  }

  async function handleBankReject(row) {
    const note = window.prompt('Rejection note (optional):')
    if (note === null) return

    const key = rowKey('bank', row.id)
    setBusyId(row.id)
    clearRowError(key)
    setSectionSuccess((s) => ({ ...s, bank: '' }))

    try {
      await rejectBankTopup(row.id, note)
      setSectionSuccess((s) => ({ ...s, bank: 'Bank top-up rejected.' }))
      await load()
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [key]: getErrorMessage(err) }))
    } finally {
      setBusyId(null)
    }
  }

  async function handleViewProof(row) {
    const key = rowKey('withdraw', row.id)
    clearRowError(key)
    try {
      const { url } = await fetchWithdrawUtrProof(row.id)
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [key]: err.message || 'Could not open proof' }))
    }
  }

  async function handleWithdrawApprove(row) {
    const form = withdrawForms[row.id] || {}
    const utr = (form.utr || '').trim()
    if (!utr) {
      setRowErrors((prev) => ({
        ...prev,
        [rowKey('withdraw', row.id)]: 'NEFT/RTGS UTR is required.',
      }))
      return
    }

    const ownerName = row.users?.name || 'owner'
    const confirmed = window.confirm(
      `Pay ${formatInr(row.amount)} to ${ownerName} with UTR ${utr}?`,
    )
    if (!confirmed) return

    const key = rowKey('withdraw', row.id)
    setBusyId(row.id)
    clearRowError(key)
    setSectionSuccess((s) => ({ ...s, withdraw: '' }))

    try {
      const result = await approveWithdrawRequest(row.id, {
        utr,
        note: form.note || '',
        proofFile: form.proofFile || null,
      })
      if (result.pendingSecondApproval || result.httpStatus === 202) {
        setSectionSuccess((s) => ({
          ...s,
          withdraw: 'Sent to dual approvals — a different admin must confirm.',
        }))
      } else {
        setSectionSuccess((s) => ({
          ...s,
          withdraw: `Paid ${formatInr(row.amount)} to ${ownerName}.`,
        }))
      }
      setWithdrawForms((prev) => {
        const next = { ...prev }
        delete next[row.id]
        return next
      })
      await load()
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [key]: getErrorMessage(err) }))
    } finally {
      setBusyId(null)
    }
  }

  async function handleWithdrawReject(row) {
    const note = window.prompt('Rejection note (optional):')
    if (note === null) return

    const key = rowKey('withdraw', row.id)
    setBusyId(row.id)
    clearRowError(key)
    setSectionSuccess((s) => ({ ...s, withdraw: '' }))

    try {
      await rejectWithdrawRequest(row.id, note)
      setSectionSuccess((s) => ({ ...s, withdraw: 'Withdraw request rejected.' }))
      await load()
    } catch (err) {
      setRowErrors((prev) => ({ ...prev, [key]: getErrorMessage(err) }))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="approvals-page">
      {loadError && (
        <div className="dashboard-error treasury-banner" role="alert">
          <span>{loadError}</span>
          <button type="button" className="treasury-retry-btn" onClick={load}>
            <RefreshCw size={14} />
            Retry
          </button>
        </div>
      )}

      <p className="approvals-threshold">
        Maker-checker threshold: {formatInr(threshold)} · amounts at or above need a second admin
      </p>

      {/* Section A — Dual Approvals */}
      <section className="section-card approvals-section">
        <div className="section-header">
          <h2 className="section-title">Dual Approvals</h2>
          <span className="kpi-card-chip">{loading ? '…' : `${dualItems.length} pending`}</span>
        </div>

        {sectionSuccess.dual && (
          <div className="treasury-success approvals-section-msg" role="status">
            {sectionSuccess.dual}
          </div>
        )}

        {loading ? (
          <div className="treasury-table-skeleton">
            {[1, 2].map((n) => (
              <div key={n} className="settlement-row settlement-row--skeleton" />
            ))}
          </div>
        ) : dualItems.length === 0 ? (
          <div className="empty-state">
            <p>No pending maker-checker approvals</p>
          </div>
        ) : (
          <div className="settlement-table-wrap">
            <table className="settlement-table approvals-table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Amount</th>
                  <th>Requested by</th>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {dualItems.map((row) => {
                  const key = rowKey('dual', row.id)
                  return (
                    <tr key={row.id} className="approval-row">
                      <td data-label="Action">
                        <span className={`action-chip ${ACTION_CHIP_CLASS[row.action_type] || ''}`}>
                          {ACTION_LABELS[row.action_type] || row.action_type}
                        </span>
                      </td>
                      <td data-label="Amount">{formatInr(row.amount)}</td>
                      <td data-label="Requested by">{shortId(row.requested_by)}</td>
                      <td data-label="Date">{formatDateTime(row.created_at)}</td>
                      <td data-label="Status">
                        <span className="status-pill status-pill--mismatch">Pending 2nd</span>
                      </td>
                      <td data-label="Actions">
                        <div className="approval-actions">
                          <button
                            type="button"
                            className="settlement-transfer-btn"
                            disabled={busyId === row.id}
                            onClick={() => handleDualApprove(row)}
                          >
                            {busyId === row.id ? (
                              <Loader2 size={14} className="treasury-spin" />
                            ) : null}
                            Second Approve
                          </button>
                          <button
                            type="button"
                            className="approval-reject-btn"
                            disabled={busyId === row.id}
                            onClick={() => handleDualReject(row)}
                          >
                            Reject
                          </button>
                        </div>
                        {rowErrors[key] && (
                          <p className="settlement-row-error" role="alert">{rowErrors[key]}</p>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Section B — Bank Top-ups */}
      <section className="section-card approvals-section">
        <div className="section-header">
          <h2 className="section-title">Bank Top-up Approvals</h2>
          <span className="kpi-card-chip">{loading ? '…' : `${bankItems.length} pending`}</span>
        </div>

        {sectionSuccess.bank && (
          <div className="treasury-success approvals-section-msg" role="status">
            {sectionSuccess.bank}
          </div>
        )}

        {loading ? (
          <div className="treasury-table-skeleton">
            <div className="settlement-row settlement-row--skeleton" />
          </div>
        ) : bankItems.length === 0 ? (
          <div className="empty-state">
            <p>No pending bank top-ups</p>
          </div>
        ) : (
          <div className="settlement-table-wrap">
            <table className="settlement-table approvals-table">
              <thead>
                <tr>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>UTR</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {bankItems.map((row) => {
                  const key = rowKey('bank', row.id)
                  return (
                    <tr key={row.id} className="approval-row">
                      <td data-label="Amount">{formatInr(row.amount)}</td>
                      <td data-label="Method">{row.method}</td>
                      <td data-label="UTR">
                        <span className="settlement-ref">{row.utr}</span>
                      </td>
                      <td data-label="Date">{formatDateTime(row.created_at)}</td>
                      <td data-label="Actions">
                        <div className="approval-actions">
                          <button
                            type="button"
                            className="settlement-transfer-btn"
                            disabled={busyId === row.id}
                            onClick={() => handleBankApprove(row)}
                          >
                            {busyId === row.id ? (
                              <Loader2 size={14} className="treasury-spin" />
                            ) : null}
                            Approve
                          </button>
                          <button
                            type="button"
                            className="approval-reject-btn"
                            disabled={busyId === row.id}
                            onClick={() => handleBankReject(row)}
                          >
                            Reject
                          </button>
                        </div>
                        {rowErrors[key] && (
                          <p className="settlement-row-error" role="alert">{rowErrors[key]}</p>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Section C — Withdraw Approvals */}
      <section className="section-card approvals-section">
        <div className="section-header">
          <h2 className="section-title">Withdraw Approvals</h2>
          <span className="kpi-card-chip">{loading ? '…' : `${withdrawItems.length} pending`}</span>
        </div>

        {sectionSuccess.withdraw && (
          <div className="treasury-success approvals-section-msg" role="status">
            {sectionSuccess.withdraw}
          </div>
        )}

        {loading ? (
          <div className="treasury-table-skeleton">
            <div className="settlement-row settlement-row--skeleton" />
          </div>
        ) : withdrawItems.length === 0 ? (
          <div className="empty-state">
            <p>No pending withdrawals</p>
          </div>
        ) : (
          <div className="settlement-table-wrap">
            <table className="settlement-table approvals-table">
              <thead>
                <tr>
                  <th>Owner</th>
                  <th>Amount</th>
                  <th>Bank</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {withdrawItems.map((row) => {
                  const key = rowKey('withdraw', row.id)
                  const awaiting = row.status === 'awaiting_second_approval'
                  const form = withdrawForms[row.id] || {}

                  return (
                    <tr key={row.id} className="approval-row">
                      <td data-label="Owner">{row.users?.name || shortId(row.user_id)}</td>
                      <td data-label="Amount">{formatInr(row.amount)}</td>
                      <td data-label="Bank">
                        {row.bank_name || 'Bank'}
                        {row.account_last4 ? ` ****${row.account_last4}` : ''}
                        {row.ifsc ? ` · ${row.ifsc}` : ''}
                      </td>
                      <td data-label="Status">
                        {awaiting ? (
                          <span className="status-pill status-pill--mismatch">Awaiting 2nd approval</span>
                        ) : (
                          <span className="status-pill status-pill--ok">Pending</span>
                        )}
                      </td>
                      <td data-label="Date">{formatDateTime(row.created_at)}</td>
                      <td data-label="Actions">
                        {awaiting ? (
                          <span className="kpi-card-chip">Use Dual Approvals section</span>
                        ) : (
                          <div className="approval-withdraw-form">
                            <input
                              type="text"
                              className="utr-input"
                              placeholder="NEFT / RTGS UTR"
                              maxLength={22}
                              value={form.utr || ''}
                              disabled={busyId === row.id}
                              onChange={(e) => updateWithdrawForm(row.id, { utr: e.target.value })}
                            />
                            <input
                              type="file"
                              className="proof-input"
                              accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
                              disabled={busyId === row.id}
                              onChange={(e) => updateWithdrawForm(row.id, {
                                proofFile: e.target.files?.[0] || null,
                              })}
                            />
                            <input
                              type="text"
                              className="utr-input"
                              placeholder="Admin note (optional)"
                              maxLength={200}
                              value={form.note || ''}
                              disabled={busyId === row.id}
                              onChange={(e) => updateWithdrawForm(row.id, { note: e.target.value })}
                            />
                            {row.utr_proof_path && (
                              <button
                                type="button"
                                className="approval-link-btn"
                                onClick={() => handleViewProof(row)}
                              >
                                View Proof
                              </button>
                            )}
                            <div className="approval-actions">
                              <button
                                type="button"
                                className="settlement-transfer-btn"
                                disabled={busyId === row.id}
                                onClick={() => handleWithdrawApprove(row)}
                              >
                                {busyId === row.id ? (
                                  <Loader2 size={14} className="treasury-spin" />
                                ) : null}
                                Approve
                              </button>
                              <button
                                type="button"
                                className="approval-reject-btn"
                                disabled={busyId === row.id}
                                onClick={() => handleWithdrawReject(row)}
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                        )}
                        {rowErrors[key] && (
                          <p className="settlement-row-error" role="alert">{rowErrors[key]}</p>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
