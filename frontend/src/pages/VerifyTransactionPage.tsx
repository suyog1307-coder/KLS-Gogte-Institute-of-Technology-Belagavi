import React, { useState, useEffect } from 'react'
import { ShieldCheck, ShieldX, Hash, Key, RefreshCw, Copy } from 'lucide-react'
import toast from 'react-hot-toast'
import { useSearchParams } from 'react-router-dom'
import { txApi } from '../services/api'

interface VerificationResult {
  transaction_id: string
  valid: boolean
  status: string
  hash_match: boolean
  signature_valid: boolean
  replay_safe: boolean
  message: string
  checked_at: string
}

function CheckRow({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
      <span className="text-gray-400 text-sm">{label}</span>
      <span className={value ? 'badge-green' : 'badge-red'}>
        {value ? '✓ Pass' : '✗ Fail'}
      </span>
    </div>
  )
}

export default function VerifyTransactionPage() {
  const [searchParams] = useSearchParams()
  const [txId, setTxId]     = useState(searchParams.get('id') || '')
  const [result, setResult] = useState<VerificationResult | null>(null)
  const [loading, setLoading] = useState(false)

  // Auto-verify if ID came from URL
  useEffect(() => {
    const idFromUrl = searchParams.get('id')
    if (idFromUrl) {
      setTxId(idFromUrl)
      runVerify(idFromUrl)
    }
  }, [])

  const runVerify = async (id: string) => {
    if (!id.trim()) return
    setLoading(true)
    setResult(null)
    try {
      const { data } = await txApi.verify(id.trim())
      setResult(data)
      if (data.valid) {
        toast.success('Transaction verified successfully!')
      } else {
        toast.error(`Verification failed: ${data.status}`)
      }
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault()
    runVerify(txId)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <ShieldCheck className="text-blue-400" size={24} />
          Verify Transaction
        </h1>
        <p className="text-gray-400 mt-1">
          Verify signature integrity, hash match, and replay protection
        </p>
      </div>

      {/* Input */}
      <div className="card">
        <form onSubmit={handleVerify} className="space-y-3">
          <div>
            <label className="label">Transaction ID</label>
            <div className="flex gap-2">
              <input
                className="input flex-1 font-mono text-sm"
                value={txId}
                onChange={(e) => setTxId(e.target.value)}
                placeholder="e8d9d9a2-c927-4060-9a67-2baf77de7990"
              />
              <button
                type="submit"
                className="btn-primary flex items-center gap-2 shrink-0"
                disabled={loading || !txId.trim()}
              >
                <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                {loading ? 'Verifying...' : 'Verify'}
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Paste the full Transaction ID (e.g. e8d9d9a2-c927-4060-9a67-2baf77de7990)
            </p>
          </div>
        </form>
      </div>

      {/* Result */}
      {result && (
        <div className={`card ${result.valid
          ? 'border-green-800 bg-green-900/10'
          : 'border-red-800 bg-red-900/10'}`}>

          {/* Header */}
          <div className="flex items-center gap-3 mb-4">
            {result.valid
              ? <ShieldCheck className="text-green-400" size={28} />
              : <ShieldX className="text-red-400" size={28} />}
            <div>
              <h3 className={`font-bold text-lg ${result.valid ? 'text-green-300' : 'text-red-300'}`}>
                {result.valid ? 'VALID TRANSACTION' : 'INVALID TRANSACTION'}
              </h3>
              <p className="text-sm text-gray-400">{result.message}</p>
            </div>
          </div>

          {/* 3 checks */}
          <div className="bg-gray-900 rounded-lg p-4 mb-4">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Verification Checks
            </h4>
            <CheckRow label="Payload Hash Integrity" value={result.hash_match} />
            <CheckRow label="ECDSA Signature Valid"  value={result.signature_valid} />
            <CheckRow label="Replay Attack Safe"     value={result.replay_safe} />
          </div>

          {/* Details */}
          <div className="space-y-3 text-sm">
            {/* Full transaction ID with copy */}
            <div>
              <p className="text-gray-400 text-xs mb-1">Transaction ID</p>
              <div className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-2">
                <code className="text-gray-200 text-xs font-mono flex-1 break-all select-all">
                  {result.transaction_id}
                </code>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(result.transaction_id)
                    toast.success('Copied!')
                  }}
                  className="text-gray-500 hover:text-blue-400 transition-colors shrink-0"
                  title="Copy"
                >
                  <Copy size={13} />
                </button>
              </div>
            </div>

            <div className="flex justify-between items-center">
              <span className="text-gray-400">Status</span>
              <span className={
                result.status === 'verified' ? 'badge-green' :
                result.status === 'tampered' ? 'badge-red' : 'badge-yellow'
              }>
                {result.status.toUpperCase()}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-400">Checked At</span>
              <span className="text-gray-300 text-xs">
                {new Date(result.checked_at).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* How it works */}
      <div className="card">
        <h3 className="font-semibold text-white mb-3">How Verification Works</h3>
        <div className="space-y-3 text-sm text-gray-400">
          <div className="flex gap-3">
            <Hash size={16} className="text-blue-400 mt-0.5 shrink-0" />
            <div>
              <span className="text-white font-medium">Hash Check</span> — Recomputes SHA-256 of
              the canonical payload and compares to stored hash. Any field modification is detected.
            </div>
          </div>
          <div className="flex gap-3">
            <Key size={16} className="text-blue-400 mt-0.5 shrink-0" />
            <div>
              <span className="text-white font-medium">Signature Check</span> — Verifies the ECDSA
              P-256 signature against the sender's registered public key.
            </div>
          </div>
          <div className="flex gap-3">
            <ShieldCheck size={16} className="text-blue-400 mt-0.5 shrink-0" />
            <div>
              <span className="text-white font-medium">Replay Check</span> — Confirms the nonce was
              consumed and has not been reused.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
