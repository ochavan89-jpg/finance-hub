import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut, Shield } from 'lucide-react'
import { supabase } from '../lib/supabase.js'

export default function Dashboard() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setEmail(user?.email || '')
    })
  }, [])

  async function handleLogout() {
    setLoggingOut(true)
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="dashboard-brand">
          <Shield size={22} className="dashboard-brand-icon" />
          <span>Finance Hub</span>
        </div>
        <button
          type="button"
          className="dashboard-logout"
          onClick={handleLogout}
          disabled={loggingOut}
        >
          <LogOut size={18} />
          {loggingOut ? 'Signing out…' : 'Logout'}
        </button>
      </header>

      <main className="dashboard-main">
        <div className="dashboard-card">
          <p className="dashboard-eyebrow">Admin Dashboard</p>
          <h1>Welcome to Finance Hub</h1>
          <p className="dashboard-muted">
            Your secure finance operations workspace is ready.
          </p>
          {email && (
            <div className="dashboard-user">
              <span className="dashboard-user-label">Signed in as</span>
              <span className="dashboard-user-email">{email}</span>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
