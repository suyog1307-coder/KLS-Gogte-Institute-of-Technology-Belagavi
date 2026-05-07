/**
 * KeysPage.tsx
 * ============
 * Every time "Generate Key Pair" is clicked:
 *  - A brand new Key ID, Private Key, and Public Key are generated
 *  - ALL three are displayed IMMEDIATELY — no clicks, no toggles
 *  - Keys stay active until manually revoked (no timer/expiry)
 */
import React, { useState, useEffect, useCallback } from 'react'
import {
  KeyRound, Plus, Copy, RefreshCw,
  CheckCircle, ShieldAlert, ShieldCheck, XCircle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { keysApi } from '../services/api'
import { format } from 'date-fns'

interface KeyPair {
  key_id:            string
  public_key_pem:    string
  algorithm:         string
  created_at:        string
  expires_at?:       string | null
  private_key_pem?:  string
}

// ── One-click copy button ──────────────────────────────────────────────────
function CopyBtn({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    toast.success(`${label} copied!`)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={copy}
      className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-lg
                 bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors shrink-0">
      {copied
        ? <><CheckCircle size={12} className="text-green-400" /> Copied!</>
        : <><Copy size={12} /> Copy</>}
    </button>
  )
}

// ── Key field box ──────────────────────────────────────────────────────────
function KeyField({
  label, value, color = 'blue', warning,
}: {
  label: string; value: string; color?: 'blue' | 'green' | 'gray'; warning?: string
}) {
  const textColor = { blue: 'text-blue-300', green: 'text-green-300', gray: 'text-gray-200' }[color]
  const border    = warning ? 'border-red-600/60' : 'border-gray-700'

  return (
    <div className={`rounded-xl border ${border} bg-gray-950 overflow-hidden`}>
      <div className={`flex items-center justify-between px-4 py-2.5 border-b ${border} bg-gray-900`}>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-bold uppercase tracking-widest text-gray-400 shrink-0">
            {label}
          </span>
          {warning && (
            <span className="text-xs text-red-400 font-medium">{warning}</span>
          )}
        </div>
        <CopyBtn text={value} label={label} />
      </div>
      <pre className={`px-4 py-3 text-xs font-mono ${textColor} whitespace-pre-wrap break-all
                       select-all leading-relaxed overflow-y-auto`}
           style={{ maxHeight: color === 'green' ? '200px' : '110px' }}>
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
    setNewKey(null)   // clear previous so React always re-renders fresh
    try {
      const { data } = await keysApi.generate()
      setNewKey(data)
      toast.success('New key pair generated! Copy your private key now.')
      keysApi.list().then(({ data: list }) => setKeys(list)).catch(() => {})
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Key generation failed')
    } finally {
      setGenerating(false)
    }
  }

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
            ECDSA P-256 key pairs · Keys stay active until revoked ·
            Private key shown <strong className="text-white">once only</strong>
          </p>
        </div>
        <button onClick={generateKey} disabled={generating}
          className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          {generating ? 'Generating...' : 'Generate Key Pair'}
        </button>
      </div>

      {/* ── Info banner ── */}
      <div className="card border-blue-800 bg-blue-900/10 flex items-start gap-3 py-3">
        <ShieldCheck className="text-blue-400 shrink-0 mt-0.5" size={18} />
        <p className="text-xs text-blue-300/80">
          <strong className="text-blue-300">How it works:</strong> Click "Generate Key Pair" →
          Copy the <strong className="text-white">Key ID</strong> and{' '}
          <strong className="text-white">Private Key</strong> →
          Use them in the Sign Transaction page.
          Keys stay active until you revoke them.
        </p>
      </div>

      {/* ── NEW KEY PANEL — shown immediately after generation ── */}
      {newKey && (
        <div className="rounded-2xl border-2 border-yellow-600/60 bg-yellow-950/20 p-5 space-y-4">

          {/* Title */}
          <div className="flex items-center gap-3">
            <ShieldAlert className="text-yellow-400 shrink-0" size={22} />
            <div>
              <h2 className="text-yellow-300 font-bold text-lg">New Key Pair Generated</h2>
              <p className="text-yellow-500/70 text-xs mt-0.5">
                Copy and save your <strong className="text-yellow-300">Private Key</strong> now —
                it will <strong className="text-yellow-300">never be shown again</strong>.
              </p>
            </div>
          </div>

          {/* ── KEY ID ── */}
          <KeyField
            label="Key ID — use this in Sign Transaction"
            value={newKey.key_id}
            color="blue"
          />

          {/* ── PRIVATE KEY — always fully visible ── */}
          <KeyField
            label="Private Key (PEM)"
            value={newKey.private_key_pem ?? '(not available)'}
            color="green"
            warning="⚠ Save now — shown only once!"
          />

          {/* ── PUBLIC KEY ── */}
          <KeyField
            label="Public Key (PEM)"
            value={newKey.public_key_pem}
            color="gray"
          />

          {/* Meta */}
          <div className="flex flex-wrap gap-4 text-xs text-gray-500 pt-1 border-t border-gray-800">
            <span>Algorithm: <strong className="text-gray-300">{newKey.algorithm}</strong></span>
            <span>Generated: <strong className="text-gray-300">
              {format(new Date(newKey.created_at), 'dd MMM yyyy, HH:mm:ss')}
            </strong></span>
            <span className="text-green-500">✓ No expiry — stays active until revoked</span>
          </div>

        </div>
      )}

      {/* ── KEY HISTORY LIST ── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-white">Your Key Pairs</h2>
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
            {keys.map((k) => (
              <div key={k.key_id} className="rounded-xl p-3 bg-gray-800 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <span className="badge-blue text-xs">{k.algorithm}</span>
                    <span className="badge-green text-xs flex items-center gap-1">
                      <CheckCircle size={10} /> Active
                    </span>
                    <span className="text-xs text-gray-500">
                      {format(new Date(k.created_at), 'dd MMM yyyy, HH:mm:ss')}
                    </span>
                  </div>
                  {/* Full key ID always visible */}
                  <code className="text-xs text-gray-300 font-mono break-all leading-relaxed">
                    {k.key_id}
                  </code>
                </div>
                <button
                  onClick={() => { navigator.clipboard.writeText(k.key_id); toast.success('Key ID copied!') }}
                  className="text-gray-500 hover:text-blue-400 transition-colors p-1 shrink-0"
                  title="Copy Key ID">
                  <Copy size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
