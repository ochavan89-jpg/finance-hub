import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Lock, Mail, Shield } from 'lucide-react'
import { supabase } from '../lib/supabase.js'

export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })

    setLoading(false)

    if (authError) {
      setError(authError.message || 'Sign in failed. Please try again.')
      return
    }

    navigate('/dashboard')
  }

  return (
    <div className="login-page">
      <div className="login-bg-glow login-bg-glow--1" />
      <div className="login-bg-glow login-bg-glow--2" />

      <div className="login-card">
        <header className="login-header">
          <div className="login-logo">
            <Shield size={28} strokeWidth={1.75} />
          </div>
          <p className="login-brand">Development Express</p>
          <h1 className="login-title">Finance Hub</h1>
          <p className="login-subtitle">Secure admin access</p>
        </header>

        <form className="login-form" onSubmit={handleSubmit}>
          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          <label className="login-field">
            <span className="login-label">Email</span>
            <div className="login-input-wrap">
              <Mail size={18} className="login-input-icon" />
              <input
                type="email"
                autoComplete="email"
                placeholder="admin@developmentexpress.in"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
              />
            </div>
          </label>

          <label className="login-field">
            <span className="login-label">Password</span>
            <div className="login-input-wrap">
              <Lock size={18} className="login-input-icon" />
              <input
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>
          </label>

          <button type="submit" className="login-submit" disabled={loading}>
            {loading ? (
              <>
                <span className="login-btn-spinner" />
                Signing in…
              </>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        <footer className="login-footer">
          <span className="login-footer-dot" />
          Encrypted connection · Authorized personnel only
        </footer>
      </div>
    </div>
  )
}
