const FINANCE_2FA_BASE = '/api/finance-2fa'

async function finance2faFetch(path, { token, method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${FINANCE_2FA_BASE}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return data
}

export function fetchClientIpInfo() {
  return finance2faFetch('/client-ip')
}

export function fetch2faStatus(token) {
  return finance2faFetch('/status', { token })
}

export function start2faSetup(token) {
  return finance2faFetch('/setup/start', { token, method: 'POST' })
}

export function confirm2faSetup(token, code) {
  return finance2faFetch('/setup/confirm', { token, method: 'POST', body: { code } })
}

export function verify2faLogin(token, code) {
  return finance2faFetch('/verify', { token, method: 'POST', body: { code } })
}

export function disable2fa(token, code) {
  return finance2faFetch('/disable', { token, method: 'POST', body: { code } })
}
