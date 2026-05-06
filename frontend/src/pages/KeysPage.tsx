import React, { useState, useEffect, useRef, useCallback } from 'react'
import { KeyRound, Plus, Copy, Eye, EyeOff, AlertTriangle, Clock, XCircle, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import { keysApi } from '../services/api'
import { format } from 'date-fns'

interface KeyPair {
  key_id:            string
  public_key_pem:    string
  algorithm:         string
  created_at:        string
  expires_at?:       string
  seconds_remaining?: number
  private_key_pem?:  string
}

// ── Countdown hook ────────────────────────────────────────────────────────────
function useCountdown(expiresAt: string | undefined, onExpire: () => void) {
  const [secondsLeft, setSecondsLeft] = useState<number>(0)
  const cbRef = useRef(onExpire)
  cbRef.current = onExpire

  useEffect(() => {
    if (!expiresAt) return
    const tick = () => {
      const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
      setSecondsLeft(diff)
      if (diff === 0) cbRef.current()
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [expiresAt])

  return secondsLeft
}

// ── Timer badge for a single key ──────────────────────────────────────────────
function KeyTimer({ expiresAt, onExpired }: { expiresAt?: string; onExpired: () => void }) {
  const secs = useCountdown(expiresAt, onExpired)

  if (!expiresAt) return null

  const pct   = Math.min(100, (secs / 180) * 100)
  const color = secs > 60 ? '#22c55e' : secs > 30 ? '#f59e0b' : '#ef4444'
  const r     = 10
  const circ  = 2 * Math.PI * r
  const dash  = (pct / 100) * circ

  if (secs === 0) {
    return (
      <span className="flex items-center gap-1 text-xs text-red-400 font-medium">
        <XCircle size={13} /> Expired
      </span>
    )
  }

  const mm = String(Math.floor(secs / 60)).padStart(2, '0')
  const ss = String(secs % 60).padStart(2, '0')

  return (
    <span className="flex items-center gap-1.5 text-xs font-mono font-semibold"
          style={{ color }}>
      {/* SVG ring */}
      <svg width="24" height="24" viewBox="0 0 24 24" className="-rotate-90">
        <circle cx="12" cy="12" r={r} fill="none" stroke="#374151" strokeWidth="2.5" />
        <circle cx="12" cy="12" r={r} fill="none" stroke={color} strokeWidth="2.5"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 1s linear, stroke 1s' }}
        />
      </svg>
      {mm}:{ss}
    </span>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function KeysPage() {
  const [keys, setKeys]           = useState<KeyPair[]>([])
  const [newKey, setNewKey]       = useState<KeyPair | null>(null)
  const [showPrivate, setShowPrivate] = useState(false)
  const [loading, setLoading]     = useState(false)
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
      setNewKey(data)
      setShowPrivate(false)
      toast.success('Key pair generated! You have 3 minutes to sign a transaction.')
      fetchKeys()
    } catch {
      toast.error('Key generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toast.success(`${label} copied`)
  }

  // When the new key's timer expires, refresh the list
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
            ECDSA P-256 key pairs · Each key expires in <strong className="text-white">3 minutes</strong>
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

      {/* New key panel — shown immediately after generation */}
      {newKey && (
        <div className="card border-yellow-700 bg-yellow-900/10">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="text-yellow-400 mt-0.5 shrink-0" size={20} />
              <div>
                <h3 className="font-semibold text-yellow-300">Save Your Private Key Now</h3>
                <p className="text-xs text-yellow-400/80 mt-1">
                  This is the ONLY time your private key is shown. It is never stored on the server.
                </p>
              </div>
            </div>
            {/* Live countdown */}
            <KeyTimer expiresAt={newKey.expires_at} onExpired={handleNewKeyExpired} />
          </div>

          <div className="space-y-3">
            {/* Key ID */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="label">Key ID</span>
                <button onClick={() => copyToClipboard(newKey.key_id, 'Key ID')}
                  className="text-xs text-blue-400 hover:underline flex items-center gap-1">
                  <Copy size={12} /> Copy
                </button>
              </div>
              <code className="block bg-gray-800 rounded p-2 text-xs text-gray-300 break-all">
                {newKey.key_id}
              </code>
            </div>

            {/* Private key */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="label">Private Key (PEM)</span>
                <div className="flex gap-2">
                  <button onClick={() => setShowPrivate(!showPrivate)}
                    className="text-xs text-gray-400 hover:text-white flex items-center gap-1">
                    {showPrivate ? <EyeOff size={12} /> : <Eye size={12} />}
                    {showPrivate ? 'Hide' : 'Show'}
                  </button>
                  <button onClick={() => copyToClipboard(newKey.private_key_pem!, 'Private key')}
                    className="text-xs text-blue-400 hover:underline flex items-center gap-1">
                    <Copy size={12} /> Copy
                  </button>
                </div>
              </div>
              {showPrivate ? (
                <pre className="bg-gray-800 rounded p-3 text-xs text-green-400 overflow-x-auto whitespace-pre-wrap break-all">
                  {newKey.private_key_pem}
                </pre>
              ) : (
                <div className="bg-gray-800 rounded p-3 text-xs text-gray-500 text-center">
                  Click "Show" to reveal private key
                </div>
              )}
            </div>

            {/* Public key */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="label">Public Key (PEM)</span>
                <button onClick={() => copyToClipboard(newKey.public_key_pem, 'Public key')}
                  className="text-xs text-blue-400 hover:underline flex items-center gap-1">
                  <Copy size={12} /> Copy
                </button>
              </div>
              <pre className="bg-gray-800 rounded p-3 text-xs text-blue-300 overflow-x-auto whitespace-pre-wrap break-all">
                {newKey.public_key_pem}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* All keys list */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-white">Your Key Pairs</h2>
          <button onClick={fetchKeys} className="text-gray-500 hover:text-white transition-colors">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {loading ? (
          <p className="text-gray-500 text-sm">Loading...</p>
        ) : keys.length === 0 ? (
          <p className="text-gray-500 text-sm">
            No keys yet. Generate your first key pair above.
          </p>
        ) : (
          <div className="space-y-2">
            {keys.map((k) => {
              const isExpired = k.expires_at
                ? new Date(k.expires_at) < new Date()
                : false

              return (
                <div key={k.key_id}
                  className={`rounded-lg p-3 flex items-center justify-between gap-4 ${
                    isExpired ? 'bg-gray-800/40 opacity-50' : 'bg-gray-800'
                  }`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="badge-blue">{k.algorithm}</span>
                      {isExpired ? (
                        <span className="badge-red flex items-center gap-1">
                          <XCircle size={10} /> Expired
                        </span>
                      ) : (
                        <span className="badge-green">Active</span>
                      )}
                      <span className="text-xs text-gray-500">
                        {format(new Date(k.created_at), 'MMM d, HH:mm:ss')}
                      </span>
                    </div>
                    <code className="text-xs text-gray-400 break-all">{k.key_id}</code>
                  </div>

                  {/* Timer for active keys */}
                  {!isExpired && k.expires_at && (
                    <KeyTimer
                      expiresAt={k.expires_at}
                      onExpired={fetchKeys}
                    />
                  )}

                  <button onClick={() => copyToClipboard(k.key_id, 'Key ID')}
                    className="text-gray-500 hover:text-blue-400 transition-colors shrink-0"
                    title="Copy Key ID">
                    <Copy size={16} />
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
