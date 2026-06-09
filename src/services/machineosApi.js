const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'

export const TOKEN_KEY = 'developmentexpress_token'
export const REFRESH_KEY = 'developmentexpress_refresh_token'
export const USER_KEY = 'developmentexpress_user'

export function getStoredToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export async function login(email, password) {
  const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: email.trim(),
      password,
      role: 'admin',
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `Login failed (${res.status})`)
  }
  return data
}

export async function apiFetch(endpoint, options = {}) {
  const token = getStoredToken()
  if (!token) throw new Error('auth_required')

  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

export function fetchTreasury() {
  return apiFetch('/api/admin/treasury')
}

export function fetchPendingSettlements(status = 'pending_transfer') {
  return apiFetch(`/api/admin/pending-settlements?status=${encodeURIComponent(status)}`)
}

export function retryPendingSettlement(id) {
  return apiFetch(`/api/admin/pending-settlements/${id}/retry`, { method: 'POST' })
}

export function fetchDualApprovals(status = 'pending_second_approval') {
  return apiFetch(`/api/admin/dual-approvals?status=${encodeURIComponent(status)}`)
}

export function approveDualApproval(id, note = '') {
  return apiFetch(`/api/admin/dual-approvals/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  })
}

export function rejectDualApproval(id, note = '') {
  return apiFetch(`/api/admin/dual-approvals/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  })
}

export function fetchBankTopups(status = 'pending') {
  return apiFetch(`/api/admin/bank-topups?status=${encodeURIComponent(status)}`)
}

export function approveBankTopup(id, note = '') {
  return apiFetch(`/api/admin/bank-topups/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  })
}

export function rejectBankTopup(id, note = '') {
  return apiFetch(`/api/admin/bank-topups/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  })
}

export function fetchWithdrawRequests(status = 'pending') {
  return apiFetch(`/api/admin/withdraw-requests?status=${encodeURIComponent(status)}`)
}

export function fetchWithdrawUtrProof(id) {
  return apiFetch(`/api/admin/withdraw-requests/${id}/utr-proof`)
}

export async function approveWithdrawRequest(id, formData = {}) {
  const token = getStoredToken()
  if (!token) {
    const err = new Error('auth_required')
    err.status = 401
    throw err
  }

  const body = new FormData()
  body.append('utr', formData.utr || '')
  if (formData.note) body.append('note', formData.note)
  if (formData.proofFile) body.append('proof', formData.proofFile)

  const res = await fetch(`${API_BASE_URL}/api/admin/withdraw-requests/${id}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`)
    err.status = res.status
    err.code = data.code
    throw err
  }
  return { ...data, httpStatus: res.status }
}

export function rejectWithdrawRequest(id, note = '') {
  return apiFetch(`/api/admin/withdraw-requests/${id}/reject`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  })
}

export { API_BASE_URL }
