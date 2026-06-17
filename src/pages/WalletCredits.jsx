import { useCallback, useEffect, useMemo, useState } from 'react'
import { CreditCard, Loader2, RefreshCw, Search } from 'lucide-react'
import { fetchUsers, initiateWalletCredit } from '../services/machineosApi.js'
import { formatInr } from '../lib/format.js'

const DUAL_APPROVAL_THRESHOLD = 10000

function getErrorMessage(err) {
  if (err?.status === 401 || err?.message === 'auth_required') {
    return 'Session expired. Please login again.'
  }
  return err?.message || 'Request failed'
}

function roleLabel(role) {
  if (role === 'owner') return 'Owner'
  if (role === 'client') return 'Client'
  return role || '—'
}

export default function WalletCredits() {
  const [searchQuery, setSearchQuery] = useState('')
  const [users, setUsers] = useState([])
  const [selectedUser, setSelectedUser] = useState(null)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(true)
  const [searchLoading, setSearchLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(null)
  const [showConfirm, setShowConfirm] = useState(false)

  const loadUsers = useCallback(async () => {
    setSearchLoading(true)
    setError('')
    try {
      const data = await fetchUsers({ limit: 250, offset: 0 })
      setUsers(data.items || [])
    } catch (err) {
      setUsers([])
      setError(getErrorMessage(err))
    } finally {
      setSearchLoading(false)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return (users || [])
      .filter((u) => u.role === 'client' || u.role === 'owner')
      .filter((u) => {
        if (!q) return true
        const name = (u.name || '').toLowerCase()
        const email = (u.email || '').toLowerCase()
        return name.includes(q) || email.includes(q)
      })
  }, [users, searchQuery])

  const parsedAmount = Number(amount)
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0
  const reasonValid = reason.trim().length >= 5
  const showDualWarning = amountValid && parsedAmount >= DUAL_APPROVAL_THRESHOLD

  const currentBalance = Number(selectedUser?.wallet_balance || 0)
  const newBalance = amountValid ? currentBalance + parsedAmount : currentBalance

  function handleResetForm() {
    setAmount('')
    setReason('')
    setSelectedUser(null)
    setShowConfirm(false)
    setSuccess(null)
    setError('')
  }

  function handleSelectUser(user) {
    setSelectedUser(user)
    setError('')
    setSuccess(null)
  }

  function handleOpenConfirm() {
    if (!selectedUser) return
    if (!amountValid) {
      setError('Enter a positive credit amount')
      return
    }
    if (!reasonValid) {
      setError('Reason is required (min 5 characters)')
      return
    }
    setError('')
    setSuccess(null)
    setShowConfirm(true)
  }

  async function handleConfirmCredit() {
    if (!selectedUser || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await initiateWalletCredit({
        userId: selectedUser.id,
        amount: parsedAmount,
        reason: reason.trim(),
      })
      setShowConfirm(false)
      const creditedName = selectedUser.name || selectedUser.email || 'user'
      if (result.pendingSecondApproval) {
        setSuccess({
          type: 'dual',
          userName: creditedName,
          reference: result.reference,
        })
      } else {
        setSuccess({
          type: 'success',
          userName: creditedName,
          amount: parsedAmount,
          reference: result.reference,
        })
      }
      setAmount('')
      setReason('')
      setSelectedUser(null)
      await loadUsers()
    } catch (err) {
      setShowConfirm(false)
      setError(getErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wallet-credits-page">
      <header className="wallet-credits-header">
        <div className="wallet-credits-header-icon">
          <CreditCard size={22} strokeWidth={1.75} />
        </div>
        <div>
          <h2 className="wallet-credits-title">Wallet Credits</h2>
          <p className="wallet-credits-subtitle">
            Admin-initiated wallet top-ups with full audit trail
          </p>
        </div>
        <button
          type="button"
          className="wallet-credits-refresh-btn"
          onClick={loadUsers}
          disabled={searchLoading}
        >
          <RefreshCw size={14} className={searchLoading ? 'spin-icon' : ''} />
          Refresh
        </button>
      </header>

      {error && !showConfirm && (
        <div className="result-banner result-banner--error" role="alert">
          <p>{error}</p>
          <button type="button" className="wallet-credits-text-btn" onClick={() => setError('')}>
            Try again
          </button>
        </div>
      )}

      {success?.type === 'success' && (
        <div className="result-banner result-banner--success" role="status">
          <p>
            ✅ {formatInr(success.amount)} credited to {success.userName}
          </p>
          {success.reference && (
            <p className="wallet-credits-ref">Transaction: {success.reference}</p>
          )}
          <button type="button" className="wallet-credits-reset-btn" onClick={handleResetForm}>
            Reset form
          </button>
        </div>
      )}

      {success?.type === 'dual' && (
        <div className="result-banner result-banner--dual" role="status">
          <p>⏳ Sent to dual approvals queue</p>
          <p className="wallet-credits-ref">Second admin must approve</p>
          {success.reference && (
            <p className="wallet-credits-ref">Reference: {success.reference}</p>
          )}
          <button type="button" className="wallet-credits-reset-btn" onClick={handleResetForm}>
            Reset form
          </button>
        </div>
      )}

      <div className="wallet-credits-layout">
        <section className="user-search-section">
          <h3 className="wallet-credits-section-title">Select User</h3>
          <div className="user-search-input-wrap">
            <Search size={16} className="user-search-input-icon" />
            <input
              type="search"
              className="user-search-input"
              placeholder="Search by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={loading}
            />
          </div>

          {loading || searchLoading ? (
            <div className="wallet-credits-loading">
              <Loader2 size={20} className="spin-icon" />
              <span>Loading users…</span>
            </div>
          ) : (
            <div className="user-list">
              {filteredUsers.length === 0 ? (
                <p className="wallet-credits-empty">No users found</p>
              ) : (
                filteredUsers.map((user) => {
                  const isSelected = selectedUser?.id === user.id
                  return (
                    <button
                      key={user.id}
                      type="button"
                      className={`user-card${isSelected ? ' user-card--selected' : ''}`}
                      onClick={() => handleSelectUser(user)}
                    >
                      <div className="user-card-top">
                        <span className="user-card-name">{user.name || 'Unnamed'}</span>
                        <span
                          className={`user-role-badge user-role-badge--${user.role === 'owner' ? 'owner' : 'client'}`}
                        >
                          {roleLabel(user.role)}
                        </span>
                      </div>
                      <span className="user-card-email">{user.email || '—'}</span>
                      <span className="user-card-balance">
                        Balance: {formatInr(user.wallet_balance)}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          )}
        </section>

        <section className="credit-form-section">
          {!selectedUser ? (
            <div className="credit-form-placeholder">
              <CreditCard size={28} strokeWidth={1.5} />
              <p>Select a client or owner to credit their wallet</p>
            </div>
          ) : (
            <>
              <h3 className="wallet-credits-section-title">Credit Details</h3>
              <div className="credit-user-preview">
                <div className="credit-user-preview-row">
                  <span className="credit-user-preview-label">Name</span>
                  <span>{selectedUser.name || '—'}</span>
                </div>
                <div className="credit-user-preview-row">
                  <span className="credit-user-preview-label">Email</span>
                  <span>{selectedUser.email || '—'}</span>
                </div>
                <div className="credit-user-preview-row">
                  <span className="credit-user-preview-label">Role</span>
                  <span
                    className={`user-role-badge user-role-badge--${selectedUser.role === 'owner' ? 'owner' : 'client'}`}
                  >
                    {roleLabel(selectedUser.role)}
                  </span>
                </div>
                <div className="credit-user-preview-row">
                  <span className="credit-user-preview-label">Current balance</span>
                  <span className="credit-user-preview-balance">
                    {formatInr(selectedUser.wallet_balance)}
                  </span>
                </div>
              </div>

              <label className="wallet-credits-field">
                <span className="wallet-credits-field-label">Amount (₹)</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  className="credit-amount-input"
                  placeholder="Enter amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>

              <label className="wallet-credits-field">
                <span className="wallet-credits-field-label">Reason</span>
                <textarea
                  className="credit-reason-textarea"
                  placeholder="Why is this credit being issued? (min 5 characters)"
                  rows={4}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>

              {showDualWarning && (
                <div className="dual-approval-warning" role="status">
                  ⚠️ Amount ≥ ₹10,000 will go to dual approvals queue for second admin approval
                </div>
              )}

              <button
                type="button"
                className="confirm-credit-btn"
                onClick={handleOpenConfirm}
                disabled={!amountValid || !reasonValid}
              >
                Credit Wallet
              </button>
            </>
          )}
        </section>
      </div>

      {showConfirm && selectedUser && (
        <div className="confirm-overlay" role="presentation" onClick={() => !busy && setShowConfirm(false)}>
          <div
            className="confirm-modal"
            role="dialog"
            aria-labelledby="confirm-credit-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="confirm-credit-title" className="confirm-modal-title">
              Confirm Wallet Credit
            </h3>
            <div className="confirm-modal-body">
              <p>
                <strong>To:</strong> {selectedUser.name || '—'} ({selectedUser.email || '—'})
              </p>
              <p>
                <strong>Role:</strong> {roleLabel(selectedUser.role)}
              </p>
              <p>
                <strong>Current Balance:</strong> {formatInr(currentBalance)}
              </p>
              <p className="confirm-credit-amount">
                <strong>Credit Amount:</strong> {formatInr(parsedAmount)}
              </p>
              <p>
                <strong>New Balance:</strong> {formatInr(newBalance)}
              </p>
              <p className="confirm-reason">
                <strong>Reason:</strong> {reason.trim()}
              </p>
              {showDualWarning && (
                <p className="confirm-dual-note">→ Dual Approval</p>
              )}
            </div>
            <div className="confirm-modal-actions">
              <button
                type="button"
                className="confirm-cancel-btn"
                onClick={() => setShowConfirm(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="confirm-credit-btn confirm-credit-btn--modal"
                onClick={handleConfirmCredit}
                disabled={busy}
              >
                {busy ? (
                  <>
                    <Loader2 size={16} className="spin-icon" />
                    Processing…
                  </>
                ) : (
                  'Confirm Credit'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
