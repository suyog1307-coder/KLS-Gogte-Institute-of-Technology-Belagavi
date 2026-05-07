/**
 * KeysPage.tsx
 * ============
 * Every time "Generate Key Pair" is clicked:
 *  - A brand new Key ID, Private Key, and Public Key are generated
 *  - ALL three are displayed IMMEDIATELY — no clicks, no toggles
 *  - 3-minute countdown timer starts
 *  - Private key is shown in full (it is NEVER shown again after leaving)
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  KeyRound, Plus, Copy, Clock, XCircle, RefreshCw, CheckCircle, ShieldAlert,
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
  const secs = useCountdown(expiresAt, onExpired)
  if (!expiresAt) return null

  if (secs === 0) return (
    <span className="flex items-center gap-1 text-xs text-red-400 font-semibold">
      <XCircle size={13} /> EXPIRED
    </span>
  )

  const color = secs > 60 ? '#22c55e' : secs > 30 ? '#f59e0b' : '#ef4444'
  const r = 10, circ = 2 * Math.PI * r
  const pct = Math.min(100, (secs / 180) * 100)
  const mm = String(Math.floor(secs / 60)).padStart(2, '0')
  const ss = String(secs % 60).padStart(2, '0')

  return (
    <span className="flex items-center gap-1.5 font-mono font-bold text-sm" style={{ color }}>
      <svg width="28" height="28" viewBox="0 0 24 24" className="-rotate-90">
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

// ── One-click copy button ──────────────────────────────────────────────────
function CopyBtn({ text, label, size = 'sm' }: { text: string; label: string; size?: 'sm' | 'lg' }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    toast.success(`${label} copied!`)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={copy}
      className={`flex items-center gap-1.5 rounded-lg transition-colors shrink-0 ${
        size === 'lg'
          ? 'px-3 py-1.5 text-sm bg-blue-600/20 hover:bg-blue-600/40 text-blue-300 border border-blue-700/50'
          : 'px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300'
      }`}>
      {copied
        ? <><CheckCircle size={13} className="text-green-400" /> Copied!</>
        : <><Copy size={13} /> Copy</>}
    </button>
  )
}

// ── Key field box ──────────────────────────────────────────────────────────
function KeyField({
  label, value, color = 'blue', highlight = false,
}: {
  label: string; value: string; color?: 'blue' | 'green' | 'gray'; highlight?: boolean
}) {
  const textColor = { blue: 'text-blue-300', green: 'text-green-300', gray: 'text-gray-200' }[color]
  const border    = highlight ? 'border-red-600/70' : 'border-gray-700'

  return (
    <div className={`rounded-xl border ${border} bg-gray-950 overflow-hidden`}>
      {/* Label bar */}
      <div className={`flex items-center justify-between px-4 py-2 border-b ${border} bg-gray-900`}>
        <span className="text-xs font-bold uppercase tracking-widest text-gray-400">
          {label}
          {highlight && (
            <span className="ml-2 text-red-400 normal-case font-normal">
              ⚠ Save now — shown only once!
            </span>
          )}
        </span>
        <CopyBtn text={value} label={label} size="sm" />
      </div>
      {/* Value */}
      <pre className={`px-4 py-3 text-xs font-mono ${textColor} whitespace-pre-wrap break-all
                       select-all leading-relaxed overflow-y-auto`}
           style={{ maxHeight: highlight ? '220px' : '120px' }}>
        {value}
      </pre>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function KeysPage() {
  const [keys, setKeys]         = useState<KeyPair[]>([])
  const [newKey, setNewKey]     = useState<KeyPair | null>(null)
  const [loading, setLoading]   = useState(false)
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
    setNewKey(null)   // clear previous key first so React re-renders fresh
    try {
      const { data } = await keysApi.generate()
      setNewKey(data)  // set new key — ALL fields shown immediately, no toggle
      toast.success('New key pair generated! Copy your private key now.')
      keysApi.list().then(({ data: list }) => setKeys(list)).catch(() => {})
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Key generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const handleExpired = useCallback(() => {
    toast.error('Key expired! Generate a new key pair.', { duration: 5000 })
    setNewKey(null)
    fetchKeys()
  }, [fetchKeys])

  return (
    <div className="max-w-4xl mx-auto space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <KeyRound className="text-blue-400" size={24} />
            Key Management
          </h1>
          <p className="text-gray-400 mt-1 text-sm">
            Each key pair is unique · Expires in <strong className="text-white">3 minutes</strong> ·
            Private key shown <strong className="text-white">once only</strong>
          </p>
        </div>
        <button onClick={generateKey} disabled={generating}
          className="btn-primary flex items-center gap-2 text-sm px-4 py-2">
          <Plus size={18} />
          {generating ? 'Generating...' : 'Generate Key Pair'}
        </button>
      </div>

      {/* ── Info banner ── */}
      <div className="card border-blue-800 bg-blue-900/10 flex items-start gap-3 py-3">
        <Clock className="text-blue-400 shrink-0 mt-0.5" size={18} />
        <p className="text-xs text-blue-300/80">
          <strong className="text-blue-300">How it works:</strong> Click "Generate Key Pair" →
          A unique Key ID, Private Key, and Public Key appear instantly →
          Copy the Private Key → Use it to sign a transaction within 3 minutes →
          Key auto-expires and a new one must be generated for the next transaction.
        </p>
      </div>

      {/* ── NEW KEY PANEL — shown immediately after generation ── */}
      {newKey && (
        <div className="rounded-2xl border-2 border-yellow-600/60 bg-yellow-950/20 p-5 space-y-4">

          {/* Title + timer */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ShieldAlert className="text-yellow-400" size={22} />
              <div>
                <h2 className="text-yellow-300 font-bold text-lg">New Key Pair Generated</h2>
                <p className="text-yellow-500/70 text-xs mt-0.5">
                  All details are shown below. Copy and save your private key before the timer runs out.
                </p>
              </div>
            </div>
            <div className="flex flex-col items-center gap-0.5">
              <KeyTimer expiresAt={newKey.expires_at} onExpired={handleExpired} />
              <span className="text-xs text-gray-500">remaining</span>
            </div>
          </div>

          {/* ── KEY ID — full UUID ── */}
          <KeyField
            label="Key ID (use this in Sign Transaction)"
            value={newKey.key_id}
            color="blue"
          />

          {/* ── PRIVATE KEY — always fully visible ── */}
          <KeyField
            label="Private Key (PEM)"
            value={newKey.private_key_pem ?? '(not available)'}
            color="green"
            highlight={true}
          />

          {/* ── PUBLIC KEY ── */}
          <KeyField
            label="Public Key (PEM)"
            value={newKey.public_key_pem}
            color="gray"
          />

          {/* Meta info */}
          <div className="flex flex-wrap gap-4 text-xs text-gray-500 pt-1 border-t border-gray-800">
            <span>Algorithm: <strong className="text-gray-300">{newKey.algorithm}</strong></span>
            <span>Generated: <strong className="text-gray-300">
              {format(new Date(newKey.created_at), 'dd MMM yyyy, HH:mm:ss')}
            </strong></span>
            {newKey.expires_at && (
              <span>Expires at: <strong className="text-yellow-400">
                {format(new Date(newKey.expires_at), 'HH:mm:ss')}
              </strong></span>
            )}
          </div>

        </div>
      )}

      {/* ── KEY HISTORY LIST ── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-white">Key History</h2>
          <button onClick={fetchKeys}
            className="text-gray-500 hover:text-white transition-colors p-1" title="Refresh">
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
              const expired = k.expires_at ? new Date(k.expires_at) < new Date() : false
              return (
                <div key={k.key_id}
                  className={`rounded-xl p-3 flex items-center gap-3 ${
                    expired ? 'bg-gray-800/30 opacity-50' : 'bg-gray-800'
                  }`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="badge-blue text-xs">{k.algorithm}</span>
                      {expired
                        ? <span className="badge-red text-xs flex items-center gap-1">
                            <XCircle size={10} /> Expired
                          </span>
                        : <span className="badge-green text-xs">Active</span>}
                      <span className="text-xs text-gray-500">
                        {format(new Date(k.created_at), 'dd MMM yyyy, HH:mm:ss')}
                      </span>
                    </div>
                    {/* Full key ID always visible */}
                    <code className="text-xs text-gray-300 font-mono break-all leading-relaxed">
                      {k.key_id}
                    </code>
                  </div>

                  {!expired && k.expires_at && (
                    <KeyTimer expiresAt={k.expires_at} onExpired={fetchKeys} />
                  )}

                  <button
                    onClick={() => { navigator.clipboard.writeText(k.key_id); toast.success('Key ID copied!') }}
                    className="text-gray-500 hover:text-blue-400 transition-colors p-1 shrink-0"
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
