import { useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Menu, PanelLeft, PanelLeftClose } from 'lucide-react'
import Sidebar from './Sidebar.jsx'

const SIDEBAR_COLLAPSED_KEY = 'finance-hub-sidebar-collapsed'

function readSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

const PAGE_TITLES = {
  '/dashboard': 'Overview',
  '/treasury': 'Treasury',
  '/transactions': 'Transactions',
  '/approvals': 'Approvals',
  '/wallet-credits': 'Wallet Credits',
  '/reports': 'Reports',
  '/settings': 'Settings',
}

export default function Layout() {
  const location = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed)

  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  function toggleSidebarCollapsed() {
    setSidebarCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        /* ignore storage errors */
      }
      return next
    })
  }

  const pageTitle = PAGE_TITLES[location.pathname] || 'Finance Hub'

  return (
    <div className={`layout-shell${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <div className="layout-ambient layout-ambient--gold" aria-hidden />
      <div className="layout-ambient layout-ambient--blue" aria-hidden />
      <div className="layout-ambient layout-ambient--rose" aria-hidden />
      <div
        className={`layout-overlay${sidebarOpen ? ' is-visible' : ''}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden={!sidebarOpen}
      />
      <Sidebar
        isOpen={sidebarOpen}
        isCollapsed={sidebarCollapsed}
        onClose={() => setSidebarOpen(false)}
      />
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
          <button
            type="button"
            className="layout-sidebar-toggle"
            onClick={toggleSidebarCollapsed}
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!sidebarCollapsed}
          >
            {sidebarCollapsed ? <PanelLeft size={20} /> : <PanelLeftClose size={20} />}
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
