import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import KeysPage from './pages/KeysPage'
import SignTransactionPage from './pages/SignTransactionPage'
import VerifyTransactionPage from './pages/VerifyTransactionPage'
import TransactionsPage from './pages/TransactionsPage'
import AuditLogsPage from './pages/AuditLogsPage'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth()
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
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
        <Route path="keys" element={<KeysPage />} />
        <Route path="transactions" element={<TransactionsPage />} />
        <Route path="sign" element={<SignTransactionPage />} />
        <Route path="verify" element={<VerifyTransactionPage />} />
        <Route path="audit" element={<AuditLogsPage />} />
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
