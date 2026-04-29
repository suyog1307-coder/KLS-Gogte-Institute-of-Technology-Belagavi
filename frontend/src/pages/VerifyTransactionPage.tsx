import React, { useState } from 'react'
import { ShieldCheck, ShieldX, Hash, Key, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
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
  const [txId, setTxId] = useState('')
  const [result, setResult] = useState<VerificationResult | null>(null)
  const [loading, setLoading] = useState(false)

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!txId.trim()) return
    setLoading(true)
    setResult(null)
    try {
      const { data } = await txApi.verify(txId.trim())
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

      <div className="card">
        <form onSubmit={handleVerify} className="flex gap-3">
          <input
            className="input flex-1"
            value={txId}
            onChange={(e) => setTxId(e.target.value)}
            placeholder="Enter Transaction ID..."
          />
          <button type="submit" className="btn-primary flex items-center gap-2" disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Verifying...' : 'Verify'}
          </button>
        </form>
      </div>

      {result && (
        <div className={`card ${result.valid ? 'border-green-800 bg-green-900/10' : 'border-red-800 bg-red-900/10'}`}>
          {/* Header */}
          <div className="flex items-center gap-3 mb-4">
            {result.valid ? (
              <ShieldCheck className="text-green-400" size={28} />
            ) : (
              <ShieldX className="text-red-400" size={28} />
            )}
            <div>
              <h3 className={`font-bold text-lg ${result.valid ? 'text-green-300' : 'text-red-300'}`}>
                {result.valid ? 'VALID TRANSACTION' : 'INVALID TRANSACTION'}
              </h3>
              <p className="text-sm text-gray-400">{result.message}</p>
            </div>
          </div>

          {/* Checks */}
          <div className="bg-gray-900 rounded-lg p-4 mb-4">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Verification Checks
            </h4>
            <CheckRow label="Payload Hash Integrity" value={result.hash_match} />
            <CheckRow label="ECDSA Signature Valid" value={result.signature_valid} />
            <CheckRow label="Replay Attack Safe" value={result.replay_safe} />
          </div>

          {/* Details */}
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Transaction ID</span>
              <code className="text-gray-300 text-xs">{result.transaction_id}</code>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Status</span>
              <span className={
                result.status === 'verified' ? 'badge-green' :
                result.status === 'tampered' ? 'badge-red' : 'badge-yellow'
              }>
                {result.status.toUpperCase()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Checked At</span>
              <span className="text-gray-300 text-xs">
                {new Date(result.checked_at).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Explanation */}
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
              consumed within the 5-minute window and has not been reused.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
