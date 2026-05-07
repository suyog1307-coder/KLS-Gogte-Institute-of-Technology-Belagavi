import React from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import KeysPage from './pages/KeysPage'
import SignTransactionPage from './pages/SignTransactionPage'
import VerifyTransactionPage from './pages/VerifyTransactionPage'
import TransactionsPage from './pages/TransactionsPage'
import AuditLogsPage from './pages/AuditLogsPage'
import FaceEnrollPage from './pages/FaceEnrollPage'

// ── Requires login ─────────────────────────────────────────────────────────
function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />
}

// ── Requires face enrollment — redirects to /face?required=true if not done ─
function FaceGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, faceRegistered } = useAuth()
  const location = useLocation()

  if (!isAuthenticated) return <Navigate to="/login" replace />

  // Allow /face route itself (to avoid redirect loop)
  if (location.pathname === '/face') return <>{children}</>

  // If face not registered, force enrollment
  if (!faceRegistered) {
    return <Navigate to="/face?required=true" replace />
  }

  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login"    element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />

      <Route
        path="/"
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route index element={<Navigate to="/transactions" replace />} />

        {/* Face enrollment — accessible without face guard (it IS the guard) */}
        <Route path="face" element={
          <PrivateRoute><FaceEnrollPage /></PrivateRoute>
        } />

        {/* All other routes require face enrollment */}
        <Route path="keys"         element={<FaceGuard><KeysPage /></FaceGuard>} />
        <Route path="transactions" element={<FaceGuard><TransactionsPage /></FaceGuard>} />
        <Route path="sign"         element={<FaceGuard><SignTransactionPage /></FaceGuard>} />
        <Route path="verify"       element={<FaceGuard><VerifyTransactionPage /></FaceGuard>} />
        <Route path="audit"        element={<FaceGuard><AuditLogsPage /></FaceGuard>} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  )
}
