import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore.js'
import LoginPage from './pages/LoginPage.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Layout from './components/layout/Layout.jsx'
import Treasury from './pages/Treasury.jsx'
import Transactions from './pages/Transactions.jsx'
import Approvals from './pages/Approvals.jsx'
import Reports from './pages/Reports.jsx'
import Settings from './pages/Settings.jsx'

function AuthLoading() {
  return (
    <div className="auth-loading">
      <div className="auth-spinner" aria-label="Loading" />
    </div>
  )
}

function ProtectedRoute({ children }) {
  const token = useAuthStore((s) => s.token)
  const loading = useAuthStore((s) => s.loading)

  if (loading) return <AuthLoading />
  if (!token) return <Navigate to="/" replace />
  return children
}

function PublicRoute({ children }) {
  const token = useAuthStore((s) => s.token)
  const loading = useAuthStore((s) => s.loading)

  if (loading) return <AuthLoading />
  if (token) return <Navigate to="/dashboard" replace />
  return children
}

export default function App() {
  const initAuth = useAuthStore((s) => s.initAuth)

  useEffect(() => {
    initAuth()
  }, [initAuth])

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <PublicRoute>
              <LoginPage />
            </PublicRoute>
          }
        />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/treasury" element={<Treasury />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
