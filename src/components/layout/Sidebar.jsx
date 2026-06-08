import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  ArrowLeftRight,
  CheckSquare,
  ChevronRight,
  FileText,
  Landmark,
  LayoutDashboard,
  LogOut,
  Settings,
  Shield,
  X,
} from 'lucide-react'
import { useAuthStore } from '../../store/authStore.js'

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { to: '/treasury', label: 'Treasury', icon: Landmark },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/approvals', label: 'Approvals', icon: CheckSquare },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export default function Sidebar({ isOpen, onClose }) {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const signOut = useAuthStore((s) => s.signOut)
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    setLoggingOut(true)
    await signOut()
    onClose()
    navigate('/')
  }

  return (
    <aside className={`sidebar${isOpen ? ' is-open' : ''}`}>
      <div className="sidebar-brand">
        <div className="sidebar-logo">
          <Shield size={20} strokeWidth={2.25} />
        </div>
        <div className="sidebar-brand-text">
          <div className="sidebar-brand-name">Development Express</div>
          <div className="sidebar-brand-title">Finance Hub</div>
        </div>
        <button
          type="button"
          className="layout-menu-btn"
          onClick={onClose}
          aria-label="Close menu"
          style={{ marginLeft: 'auto', display: isOpen ? 'inline-flex' : 'none' }}
        >
          <X size={18} />
        </button>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `sidebar-link${isActive ? ' is-active' : ''}`}
            onClick={onClose}
          >
            <span className="sidebar-link-icon">
              <Icon size={16} strokeWidth={1.85} />
            </span>
            <span style={{ flex: 1 }}>{label}</span>
            <ChevronRight size={14} style={{ opacity: 0.45 }} />
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-footer-tag">Secure Admin Portal</div>
        {user?.email && (
          <span className="sidebar-user-email">{user.email}</span>
        )}
        <button
          type="button"
          className="sidebar-logout"
          onClick={handleLogout}
          disabled={loggingOut}
        >
          <LogOut size={16} />
          {loggingOut ? 'Signing out…' : 'Logout'}
        </button>
      </div>
    </aside>
  )
}
