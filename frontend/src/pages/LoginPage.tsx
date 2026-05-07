import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Lock, Chrome } from 'lucide-react'
import toast from 'react-hot-toast'
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google'
import { authApi } from '../services/api'
import { useAuth } from '../context/AuthContext'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const { login }               = useAuth()
  const navigate                = useNavigate()

  // After login, redirect based on face_registered status
  const handleLoginSuccess = (data: any) => {
    login(
      data.access_token,
      data.user_id,
      data.username,
      data.face_registered,
      data.profile_image || null,
      data.auth_provider || 'local',
    )
    if (!data.face_registered) {
      toast('Please register your face to continue', { icon: '🔐' })
      navigate('/face')
    } else {
      toast.success(`Welcome back, ${data.username}!`)
      navigate('/transactions')
    }
  }

  // Standard login
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { data } = await authApi.login(username, password)
      handleLoginSuccess(data)
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  // Google OAuth login
  const handleGoogleSuccess = async (credentialResponse: any) => {
    setLoading(true)
    try {
      const { data } = await authApi.googleLogin(credentialResponse.credential)
      handleLoginSuccess(data)
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Google login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="w-full max-w-md">

          {/* Logo */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-600/20 rounded-2xl mb-4">
              <Lock className="text-blue-400" size={28} />
            </div>
            <h1 className="text-2xl font-bold text-white">TxSign</h1>
            <p className="text-gray-400 mt-1">Tamper-Proof Transaction System</p>
          </div>

          <div className="card space-y-5">
            <h2 className="text-lg font-semibold text-white">Sign in</h2>

            {/* ── Google Login ── */}
            <div className="flex flex-col items-center gap-3">
              {GOOGLE_CLIENT_ID ? (
                <GoogleLogin
                  onSuccess={handleGoogleSuccess}
                  onError={() => toast.error('Google login failed')}
                  theme="filled_black"
                  shape="rectangular"
                  size="large"
                  width="100%"
                  text="signin_with"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => toast('Set VITE_GOOGLE_CLIENT_ID in .env to enable Google login')}
                  className="w-full flex items-center justify-center gap-3 px-4 py-2.5
                             bg-white hover:bg-gray-100 text-gray-800 font-medium rounded-lg
                             border border-gray-300 transition-colors"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Continue with Google
                </button>
              )}
            </div>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-gray-700" />
              <span className="text-xs text-gray-500">or sign in with password</span>
              <div className="flex-1 h-px bg-gray-700" />
            </div>

            {/* ── Password Login ── */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">Username</label>
                <input className="input" value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="your_username" required />
              </div>
              <div>
                <label className="label">Password</label>
                <input type="password" className="input" value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••" required />
              </div>
              <button type="submit" className="btn-primary w-full" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign in'}
              </button>
            </form>

            <p className="text-center text-sm text-gray-500">
              No account?{' '}
              <Link to="/register" className="text-blue-400 hover:underline">Register</Link>
            </p>
          </div>
        </div>
      </div>
    </GoogleOAuthProvider>
  )
}
