import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Lock, ArrowRight, Shield, Zap, Eye, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google'
import { authApi } from '../services/api'
import { useAuth } from '../context/AuthContext'

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

const FEATURES = [
  { icon: Shield,  text: 'ECDSA P-256 cryptographic signing' },
  { icon: Lock,    text: 'AES-256-GCM encrypted key storage' },
  { icon: Zap,     text: 'FaceNet biometric verification' },
]

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd]   = useState(false)
  const [loading, setLoading]   = useState(false)
  const { login }               = useAuth()
  const navigate                = useNavigate()

  const handleLoginSuccess = (data: any) => {
    login(data.access_token, data.user_id, data.username,
          data.face_registered, data.profile_image || null, data.auth_provider || 'local')
    if (!data.face_registered) {
      toast('Please register your face to continue', { icon: '🔐' })
      navigate('/face')
    } else {
      toast.success(`Welcome back, ${data.username}!`)
      navigate('/transactions')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { data } = await authApi.login(username, password)
      handleLoginSuccess(data)
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Login failed')
    } finally { setLoading(false) }
  }

  const handleGoogle = async (cr: any) => {
    setLoading(true)
    try {
      const { data } = await authApi.googleLogin(cr.credential)
      handleLoginSuccess(data)
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Google login failed')
    } finally { setLoading(false) }
  }

  return (
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <div className="min-h-screen flex bg-[#0a0f1e]"
           style={{ backgroundImage: 'radial-gradient(ellipse at 30% 50%, rgba(59,130,246,0.06) 0%, transparent 60%), radial-gradient(ellipse at 70% 20%, rgba(139,92,246,0.06) 0%, transparent 60%)' }}>

        {/* ── Left panel ── */}
        <div className="hidden lg:flex flex-col justify-between w-1/2 p-12
                        border-r border-white/5 relative overflow-hidden">
          {/* Background decoration */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-1/4 left-1/4 w-64 h-64 rounded-full
                            bg-blue-600/5 blur-3xl" />
            <div className="absolute bottom-1/4 right-1/4 w-48 h-48 rounded-full
                            bg-purple-600/5 blur-3xl" />
          </div>

          <div className="relative">
            <div className="flex items-center gap-3 mb-16">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600
                              flex items-center justify-center shadow-lg shadow-blue-900/40">
                <Lock size={20} className="text-white" />
              </div>
              <span className="text-xl font-bold text-white">TxSign</span>
            </div>

            <h2 className="text-4xl font-bold text-white leading-tight mb-4">
              Tamper-Proof<br />
              <span className="bg-gradient-to-r from-blue-400 to-purple-400
                               bg-clip-text text-transparent">
                Transaction Security
              </span>
            </h2>
            <p className="text-gray-400 text-lg leading-relaxed mb-10">
              Every transaction cryptographically signed, verified, and protected
              with military-grade security.
            </p>

            <div className="space-y-4">
              {FEATURES.map(({ icon: Icon, text }, i) => (
                <div key={i} className="flex items-center gap-3 animate-fade-in-up"
                     style={{ animationDelay: `${i * 100}ms` }}>
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20
                                  flex items-center justify-center">
                    <Icon size={15} className="text-blue-400" />
                  </div>
                  <span className="text-gray-300 text-sm">{text}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="text-gray-600 text-xs relative">
            © 2024 TxSign · KLS Gogte Institute of Technology
          </p>
        </div>

        {/* ── Right panel ── */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-md animate-fade-in-up">

            {/* Mobile logo */}
            <div className="lg:hidden flex items-center gap-2 mb-8">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600
                              flex items-center justify-center">
                <Lock size={18} className="text-white" />
              </div>
              <span className="font-bold text-white">TxSign</span>
            </div>

            <h1 className="text-2xl font-bold text-white mb-1">Welcome back</h1>
            <p className="text-gray-500 text-sm mb-8">Sign in to your secure account</p>

            {/* Google */}
            {GOOGLE_CLIENT_ID && (
              <>
                <div className="mb-4">
                  <GoogleLogin onSuccess={handleGoogle}
                    onError={() => toast.error('Google login failed')}
                    theme="filled_black" shape="rectangular" size="large" width="100%" />
                </div>
                <div className="flex items-center gap-3 mb-6">
                  <div className="flex-1 h-px bg-white/8" />
                  <span className="text-xs text-gray-600">or continue with password</span>
                  <div className="flex-1 h-px bg-white/8" />
                </div>
              </>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">Username</label>
                <input className="input" value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="your_username" required autoFocus />
              </div>
              <div>
                <label className="label">Password</label>
                <div className="relative">
                  <input type={showPwd ? 'text' : 'password'} className="input pr-10"
                    value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••" required />
                  <button type="button" onClick={() => setShowPwd(!showPwd)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500
                               hover:text-gray-300 transition-colors">
                    {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <button type="submit" disabled={loading}
                className="btn-primary w-full flex items-center justify-center gap-2 py-2.5">
                {loading
                  ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Signing in...</>
                  : <><span>Sign in</span><ArrowRight size={16} /></>}
              </button>
            </form>

            <p className="text-center text-sm text-gray-600 mt-6">
              No account?{' '}
              <Link to="/register" className="text-blue-400 hover:text-blue-300 transition-colors font-medium">
                Create one
              </Link>
            </p>
          </div>
        </div>
      </div>
    </GoogleOAuthProvider>
  )
}
