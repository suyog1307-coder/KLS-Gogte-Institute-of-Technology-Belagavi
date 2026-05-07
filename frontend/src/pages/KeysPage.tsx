import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  KeyRound, Plus, Copy, Eye, EyeOff,
  AlertTriangle, Clock, XCircle, RefreshCw, CheckCircle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { keysApi } from '../services/api'
import { format } from 'date-fns'

interface KeyPair {
  key_id:             string
  public_key_pem:     string
  algorithm:          string
  created_at:         string
  expires_at?:        string
  seconds_remaining?: number
  private_key_pem?:   string
}

// ── Countdown hook ─────────────────────────────────────────────────────────
function useCountdown(expiresAt: string | undefined, onExpire: () => void) {
  const [secs, setSecs] = useState(0)
  const cb = useRef(onExpire)
  cb.current = onExpire

  useEffect(() => {
    if (!expiresAt) return
    const tick = () => {
      const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
      setSecs(diff)
      if (diff === 0) cb.current()
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [expiresAt])

  return secs
}

// ── Ring timer ─────────────────────────────────────────────────────────────
function KeyTimer({ expiresAt, onExpired }: { expiresAt?: string; onExpired: () => void }) {
  const secs  = useCountdown(expiresAt, onExpired)
  if (!expiresAt) return null

  if (secs === 0) return (
    <span className="flex items-center gap-1 text-xs text-red-400 font-medium">
      <XCircle size={13} /> Expired
    </span>
  )

  const pct   = Math.min(100, (secs / 180) * 100)
  const color = secs > 60 ? '#22c55e' : secs > 30 ? '#f59e0b' : '#ef4444'
  const r = 10, circ = 2 * Math.PI * r
  const mm = String(Math.floor(secs / 60)).padStart(2, '0')
  const ss = String(secs % 60).padStart(2, '0')

  return (
    <span className="flex items-center gap-1.5 text-xs font-mono font-semibold" style={{ color }}>
      <svg width="24" height="24" viewBox="0 0 24 24" className="-rotate-90">
        <circle cx="12" cy="12" r={r} fill="none" stroke="#374151" strokeWidth="2.5" />
        <circle cx="12" cy="12" r={r} fill="none" stroke={color} strokeWidth="2.5"
          strokeDasharray={`${(pct / 100) * circ} ${circ}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 1s linear, stroke 1s' }} />
      </svg>
      {mm}:{ss}
    </span>
  )
}

// ── Copy button ────────────────────────────────────────────────────────────
function CopyBtn({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    toast.success(`${label} copied`)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={copy}
      className="text-xs text-blue-400 hover:underline flex items-center gap-1 shrink-0">
      {copied ? <CheckCircle size={12} className="text-green-400" /> : <Copy size={12} />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function KeysPage() {
  const [keys, setKeys]             = useState<KeyPair[]>([])
  const [newKey, setNewKey]         = useState<KeyPair | null>(null)
  const [showPrivate, setShowPrivate] = useState(false)
  const [loading, setLoading]       = useState(false)
  const [generating, setGenerating] = useState(false)

  const fetchKeys = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await keysApi.list()
      setKeys(data)
    } catch {
      toast.error('Failed to load keys')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchKeys() }, [fetchKeys])

  const generateKey = async () => {
    setGenerating(true)
    try {
      const { data } = await keysApi.generate()
      // ── FIX: set newKey FIRST, then refresh list in background ──
      setNewKey(data)
      setShowPrivate(false)
      toast.success('Key pair generated! You have 3 minutes to sign a transaction.')
      // Refresh list without clearing newKey
      keysApi.list().then(({ data: list }) => setKeys(list)).catch(() => {})
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Key generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const handleNewKeyExpired = useCallback(() => {
    toast.error('Key expired! Generate a new key pair.', { duration: 5000 })
    setNewKey(null)
    fetchKeys()
  }, [fetchKeys])

  return (
    <div className="max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <KeyRound className="text-blue-400" size={24} />
            Key Management
          </h1>
          <p className="text-gray-400 mt-1">
            ECDSA P-256 key pairs · Each key expires in{' '}
            <strong className="text-white">3 minutes</strong>
          </p>
        </div>
        <button onClick={generateKey} disabled={generating}
          className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          {generating ? 'Generating...' : 'Generate Key Pair'}
        </button>
      </div>

      {/* Info banner */}
      <div className="card border-blue-800 bg-blue-900/10 flex items-start gap-3 py-3">
        <Clock className="text-blue-400 shrink-0 mt-0.5" size={18} />
        <div className="text-sm">
          <p className="text-blue-300 font-medium">3-Minute Key Window</p>
          <p className="text-blue-400/70 text-xs mt-0.5">
            After generating a key, you have <strong>180 seconds</strong> to complete
            your transaction. If the timer runs out, the key is automatically revoked
            and you must generate a new one.
          </p>
        </div>
      </div>

      {/* ── New key panel ── */}
      {newKey && (
        <div className="card border-yellow-700 bg-yellow-900/10">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="text-yellow-400 mt-0.5 shrink-0" size={20} />
              <div>
                <h3 className="font-semibold text-yellow-300">Save Your Private Key Now</h3>
                <p className="text-xs text-yellow-400/80 mt-1">
                  This is the <strong>ONLY time</strong> your private key is shown.
                  It is never stored on the server.
                </p>
              </div>
            </div>
            <KeyTimer expiresAt={newKey.expires_at} onExpired={handleNewKeyExpired} />
          </div>

          <div className="space-y-4">

            {/* Key ID */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="label">Key ID</span>
                <CopyBtn text={newKey.key_id} label="Key ID" />
              </div>
              <code className="block bg-gray-900 border border-gray-700 rounded-lg p-3
                               text-sm text-blue-300 font-mono break-all select-all">
                {newKey.key_id}
              </code>
            </div>

            {/* Private key */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="label">Private Key (PEM)</span>
                <div className="flex gap-3">
                  <button onClick={() => setShowPrivate(!showPrivate)}
                    className="text-xs text-gray-400 hover:text-white flex items-center gap-1">
                    {showPrivate ? <EyeOff size={12} /> : <Eye size={12} />}
                    {showPrivate ? 'Hide' : 'Show'}
                  </button>
                  {newKey.private_key_pem && (
                    <CopyBtn text={newKey.private_key_pem} label="Private key" />
                  )}
                </div>
              </div>
              {showPrivate && newKey.private_key_pem ? (
                <pre className="bg-gray-900 border border-gray-700 rounded-lg p-3
                                text-xs text-green-400 font-mono overflow-x-auto
                                whitespace-pre-wrap break-all select-all max-h-48">
                  {newKey.private_key_pem}
                </pre>
              ) : (
                <div className="bg-gray-900 border border-gray-700 rounded-lg p-3
                                text-xs text-gray-500 text-center cursor-pointer
                                hover:border-gray-600 transition-colors"
                  onClick={() => setShowPrivate(true)}>
                  🔒 Click "Show" to reveal private key
                </div>
              )}
            </div>

            {/* Public key */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="label">Public Key (PEM)</span>
                <CopyBtn text={newKey.public_key_pem} label="Public key" />
              </div>
              <pre className="bg-gray-900 border border-gray-700 rounded-lg p-3
                              text-xs text-blue-300 font-mono overflow-x-auto
                              whitespace-pre-wrap break-all select-all max-h-36">
                {newKey.public_key_pem}
              </pre>
            </div>

          </div>
        </div>
      )}

      {/* ── All keys list ── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-white">Your Key Pairs</h2>
          <button onClick={fetchKeys}
            className="text-gray-500 hover:text-white transition-colors p-1">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {loading && keys.length === 0 ? (
          <p className="text-gray-500 text-sm">Loading...</p>
        ) : keys.length === 0 ? (
          <p className="text-gray-500 text-sm">
            No keys yet. Click <strong className="text-white">Generate Key Pair</strong> above.
          </p>
        ) : (
          <div className="space-y-2">
            {keys.map((k) => {
              const isExpired = k.expires_at
                ? new Date(k.expires_at) < new Date() : false

              return (
                <div key={k.key_id}
                  className={`rounded-lg p-3 flex items-center gap-3 transition-opacity ${
                    isExpired ? 'bg-gray-800/30 opacity-50' : 'bg-gray-800'
                  }`}>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="badge-blue">{k.algorithm}</span>
                      {isExpired
                        ? <span className="badge-red flex items-center gap-1">
                            <XCircle size={10} /> Expired
                          </span>
                        : <span className="badge-green">Active</span>
                      }
                      <span className="text-xs text-gray-500">
                        {format(new Date(k.created_at), 'MMM d, yyyy HH:mm:ss')}
                      </span>
                    </div>
                    {/* Full key ID */}
                    <code className="text-xs text-gray-300 font-mono break-all">
                      {k.key_id}
                    </code>
                  </div>

                  {/* Timer */}
                  {!isExpired && k.expires_at && (
                    <KeyTimer expiresAt={k.expires_at} onExpired={fetchKeys} />
                  )}

                  {/* Copy key ID */}
                  <button
                    onClick={() => { navigator.clipboard.writeText(k.key_id); toast.success('Key ID copied') }}
                    className="text-gray-500 hover:text-blue-400 transition-colors shrink-0 p-1"
                    title="Copy Key ID">
                    <Copy size={15} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
