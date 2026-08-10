import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { fetchMandates } from '../services/machineosApi.js'
import { formatCount, formatInr } from '../lib/format.js'

function getErrorMessage(err) {
  if (err?.status === 401 || err?.message === 'auth_required') {
    return 'Session expired. Please login again.'
  }
  return err?.message || 'Failed to load mandates'
}

function mandateStatusPill(status) {
  const s = String(status || '').toLowerCase()
  const tone =
    s === 'confirmed' || s === 'active'
      ? 'ok'
      : s === 'pending' || s === 'created'
        ? 'mismatch'
        : s === 'rejected' || s === 'failed' || s === 'cancelled'
          ? 'error'
          : 'muted'
  return <span className={`status-pill status-pill--${tone}`}>{s || '—'}</span>
}

function quotationRef(row) {
  return (
    row.quotation_ref
    || row.quotation?.quotation_ref
    || row.ref
    || row.quotation_id
    || row.id
    || '—'
  )
}

function clientName(row) {
  return (
    row.client_name
    || row.client?.name
    || row.users?.name
    || row.quotation?.client?.name
    || '—'
  )
}

export default function Mandates() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchMandates()
      setItems(data.items || data.mandates || [])
    } catch (err) {
      setItems([])
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

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

      <section className="section-card treasury-settlements">
        <div className="section-header">
          <h2 className="section-title">e-NACH Mandates</h2>
          <span className="kpi-card-chip">
            {loading ? '…' : `${formatCount(items.length)} mandates`}
          </span>
        </div>
        <p className="treasury-meta" style={{ marginTop: 0, marginBottom: '1rem' }}>
          Quotation payment mandates — status and bank details from MachineOS.
        </p>

        {loading ? (
          <div className="treasury-table-skeleton">
            {[1, 2, 3].map((n) => (
              <div key={n} className="settlement-row settlement-row--skeleton" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state">
            <p>No e-NACH mandates found.</p>
          </div>
        ) : (
          <div className="settlement-table-wrap">
            <table className="settlement-table">
              <thead>
                <tr>
                  <th>Quotation Ref</th>
                  <th>Client</th>
                  <th>Status</th>
                  <th>Max Amount</th>
                  <th>Bank</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id || quotationRef(row)} className="settlement-row">
                    <td data-label="Quotation Ref">
                      <span className="settlement-ref">{quotationRef(row)}</span>
                    </td>
                    <td data-label="Client">{clientName(row)}</td>
                    <td data-label="Status">{mandateStatusPill(row.mandate_status)}</td>
                    <td data-label="Max Amount">
                      {formatInr(row.mandate_max_amount)}
                    </td>
                    <td data-label="Bank">{row.mandate_bank_name || '—'}</td>
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
