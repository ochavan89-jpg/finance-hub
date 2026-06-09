import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar.jsx'

const PAGE_TITLES = {
  '/dashboard': 'Overview',
  '/treasury': 'Treasury',
  '/transactions': 'Transactions',
  '/approvals': 'Approvals',
  '/reports': 'Reports',
  '/settings': 'Settings',
}

export default function Layout() {
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  const pageTitle = PAGE_TITLES[location.pathname] || 'Finance Hub'

  return (
    <div className="layout-shell">
      <div className="layout-ambient layout-ambient--gold" aria-hidden />
      <div className="layout-ambient layout-ambient--blue" aria-hidden />
      <div className="layout-ambient layout-ambient--rose" aria-hidden />
      <div
        className={`layout-overlay${sidebarOpen ? ' is-visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden={!sidebarOpen}
      />
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="layout-main">
        <header className="layout-topbar">
          <button
            type="button"
            className="layout-menu-btn"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <div className="layout-topbar-content">
            <div className="layout-breadcrumb">Finance Hub / Admin</div>
            <h1 className="layout-page-title">{pageTitle}</h1>
          </div>
        </header>
        <main className="layout-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
