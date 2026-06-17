const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'



export const TOKEN_KEY = 'developmentexpress_token'

export const REFRESH_KEY = 'developmentexpress_refresh_token'

export const USER_KEY = 'developmentexpress_user'



export function getStoredToken() {

  return localStorage.getItem(TOKEN_KEY)

}



export function getStoredRefreshToken() {

  return localStorage.getItem(REFRESH_KEY)

}



let refreshPromise = null



async function handleAuthFailure() {

  const { useAuthStore } = await import('../store/authStore.js')

  await useAuthStore.getState().signOut()

  window.location.assign('/')

}



async function refreshAccessToken() {

  if (refreshPromise) return refreshPromise



  refreshPromise = (async () => {

    const refreshToken = getStoredRefreshToken()

    if (!refreshToken) {

      await handleAuthFailure()

      const err = new Error('auth_required')

      err.status = 401

      throw err

    }



    const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {

      method: 'POST',

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify({ refreshToken }),

    })

    const data = await res.json().catch(() => ({}))



    if (!res.ok || !data.token) {

      await handleAuthFailure()

      const err = new Error(data.error || 'Refresh token expired or invalid')

      err.status = res.status || 401

      throw err

    }



    const { useAuthStore } = await import('../store/authStore.js')

    useAuthStore.getState().updateAccessToken(data.token)

    return data.token

  })()



  try {

    return await refreshPromise

  } finally {

    refreshPromise = null

  }

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

  if (!token) {

    const err = new Error('auth_required')

    err.status = 401

    throw err

  }



  const res = await fetch(`${API_BASE_URL}${endpoint}`, {

    ...options,

    headers: {

      'Content-Type': 'application/json',

      Authorization: `Bearer ${token}`,

      ...(options.headers || {}),

    },

  })

  const data = await res.json().catch(() => ({}))



  if (res.status === 403) {

    const err = new Error(data.error || `Request failed (${res.status})`)

    err.status = 403

    throw err

  }



  if (res.status === 401) {

    if (!options._authRetried) {

      await refreshAccessToken()

      return apiFetch(endpoint, { ...options, _authRetried: true })

    }

    await handleAuthFailure()

    const err = new Error(data.error || 'Session expired')

    err.status = 401

    throw err

  }



  if (!res.ok) {

    const err = new Error(data.error || `Request failed (${res.status})`)

    err.status = res.status

    throw err

  }

  return data

}



function parseContentDispositionFilename(header) {

  if (!header) return null

  const match = header.match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;]+)/i)

  if (!match) return null

  const raw = (match[1] || match[2] || match[3] || '').trim()

  try {

    return decodeURIComponent(raw)

  } catch {

    return raw

  }

}



function triggerBlobDownload(blob, filename) {

  const url = URL.createObjectURL(blob)

  const anchor = document.createElement('a')

  anchor.href = url

  anchor.download = filename

  anchor.style.display = 'none'

  document.body.appendChild(anchor)

  anchor.click()

  document.body.removeChild(anchor)

  URL.revokeObjectURL(url)

}



export function fetchTransactionsPage({ limit = 100, offset = 0 } = {}) {

  const params = new URLSearchParams()

  params.set('limit', String(limit))

  params.set('offset', String(offset))

  return apiFetch(`/api/admin/transactions?${params.toString()}`)

}



export function fetchSettlementsPage({
  status = 'all',
  from = '',
  to = '',
  limit = 100,
  offset = 0,
} = {}) {
  const params = new URLSearchParams()
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  if (status) params.set('status', status)
  if (from) params.set('from', from)
  if (to) params.set('to', to)
  return apiFetch(`/api/admin/settlements?${params.toString()}`)
}



export async function downloadReconciliationCsv({ from = '', to = '', limit = 2000 } = {}, authRetried = false) {

  const token = getStoredToken()

  if (!token) {

    const err = new Error('auth_required')

    err.status = 401

    throw err

  }



  const params = new URLSearchParams()

  if (from) params.set('from', from)

  if (to) params.set('to', to)

  if (limit) params.set('limit', String(limit))



  const res = await fetch(

    `${API_BASE_URL}/api/admin/transactions/reconciliation-export.csv?${params.toString()}`,

    { headers: { Authorization: `Bearer ${token}` } },

  )



  if (res.status === 401 && !authRetried) {

    await refreshAccessToken()

    return downloadReconciliationCsv({ from, to, limit }, true)

  }



  if (res.status === 401) {

    await handleAuthFailure()

    const data = await res.json().catch(() => ({}))

    const err = new Error(data.error || 'Session expired')

    err.status = 401

    throw err

  }



  const contentType = (res.headers.get('Content-Type') || '').toLowerCase()



  if (!res.ok || contentType.includes('application/json')) {

    const data = await res.json().catch(() => ({}))

    const err = new Error(data.error || `Export failed (${res.status})`)

    err.status = res.status

    throw err

  }



  if (!contentType.includes('text/csv') && !contentType.includes('text/plain')) {

    const err = new Error('Unexpected response type — expected CSV export')

    err.status = res.status

    throw err

  }



  const blob = await res.blob()

  const filename =

    parseContentDispositionFilename(res.headers.get('Content-Disposition')) ||

    `DE-Reconciliation_${new Date().toISOString().slice(0, 10)}.csv`

  triggerBlobDownload(blob, filename)

  return { filename }

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



export async function approveWithdrawRequest(id, formData = {}, authRetried = false) {

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



  if (res.status === 401 && !authRetried) {

    await refreshAccessToken()

    return approveWithdrawRequest(id, formData, true)

  }



  if (res.status === 401) {

    await handleAuthFailure()

    const err = new Error(data.error || 'Session expired')

    err.status = 401

    throw err

  }



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



export function fetchUsers({ limit = 50, offset = 0 } = {}) {

  const params = new URLSearchParams()

  params.set('limit', String(limit))

  params.set('offset', String(offset))

  return apiFetch(`/api/admin/users?${params.toString()}`)

}



export function initiateWalletCredit({ userId, amount, reason }) {

  return apiFetch('/api/admin/wallet-credits', {

    method: 'POST',

    body: JSON.stringify({ userId, amount, reason }),

  })

}



export { API_BASE_URL }

