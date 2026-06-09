import { formatDateTime } from './format.js'

export function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const json = atob(padded)
    const payload = JSON.parse(json)
    if (!payload || typeof payload !== 'object') return null

    return {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      iat: payload.iat,
      exp: payload.exp,
    }
  } catch {
    return null
  }
}

export function isAccessTokenExpired(token) {
  const payload = decodeJwtPayload(token)
  if (!payload?.exp) return true
  return payload.exp * 1000 < Date.now()
}

export function getTokenExpiryLabel(token) {
  const payload = decodeJwtPayload(token)
  if (!payload?.exp) return '—'

  const secondsLeft = payload.exp - Math.floor(Date.now() / 1000)
  if (secondsLeft <= 0) return 'Expired'

  const minutes = Math.floor(secondsLeft / 60)
  if (minutes < 1) return 'Less than 1 min remaining'
  if (minutes === 1) return '1 min remaining'
  return `${minutes} min remaining`
}

export function getSessionStarted(token) {
  const payload = decodeJwtPayload(token)
  if (!payload?.iat) return '—'
  return formatDateTime(new Date(payload.iat * 1000).toISOString())
}
