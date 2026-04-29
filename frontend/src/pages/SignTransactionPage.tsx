import React, { useState, useEffect } from 'react'
import { Send, AlertTriangle, CheckCircle, Shield } from 'lucide-react'
import toast from 'react-hot-toast'
import { txApi, keysApi, fraudApi } from '../services/api'
import { v4 as uuidv4 } from 'uuid'

// Simple UUID v4 polyfill if uuid package not installed
function generateNonce() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36)
}

interface FraudResult {
  risk_level: string
  risk_score: number
  reason: string
  recommended_action: string
}

export default function SignTransactionPage() {
  const [form, setForm] = useState({
    receiver_id: '',
    amount: '',
    currency: 'USD',
    nonce: generateNonce(),
    timestamp: new Date().toISOString().slice(0, 19),
  })
  const [privateKey, setPrivateKey] = useState('')
  const [keyId, setKeyId] = useState('')
  const [keys, setKeys] = useState<any[]>([])
  const [result, setResult] = useState<any>(null)
  const [fraud, setFraud] = useState<FraudResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [fraudLoading, setFraudLoading] = useState(false)

  useEffect(() => {
    keysApi.list().then(({ data }) => setKeys(data)).catch(() => {})
  }, [])

  const checkFraud = async () => {
    if (!form.amount) return
    setFraudLoading(true)
    try {
      const { data } = await fraudApi.assess(parseFloat(form.amount), form.currency)
      setFraud(data)
    } catch {
      // non-critical
    } finally {
      setFraudLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!privateKey.trim()) {
      toast.error('Private key is required for signing')
      return
    }
    if (!keyId) {
      toast.error('Select a key ID')
      return
    }
    setLoading(true)
    try {
      const { data } = await txApi.sign({
        transaction: {
          receiver_id: form.receiver_id,
          amount: parseFloat(form.amount),
          currency: form.currency,
          nonce: form.nonce,
          timestamp: form.timestamp,
        },
        private_key_pem: privateKey,
        key_id: keyId,
      })
      setResult(data)
      toast.success('Transaction signed successfully!')
      // Reset nonce for next transaction
      setForm((f) => ({ ...f, nonce: generateNonce(), timestamp: new Date().toISOString().slice(0, 19) }))
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Signing failed')
    } finally {
      setLoading(false)
    }
  }

  const riskColor = (level: string) => {
    if (level === 'HIGH') return 'badge-red'
    if (level === 'MEDIUM') return 'badge-yellow'
    return 'badge-green'
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Send className="text-blue-400" size={24} />
          Sign Transaction
        </h1>
        <p className="text-gray-400 mt-1">Create and cryptographically sign a new transaction</p>
      </div>

      <div className="card space-y-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Receiver ID</label>
              <input className="input" value={form.receiver_id}
                onChange={(e) => setForm({ ...form, receiver_id: e.target.value })}
                placeholder="user-id or account number" required />
            </div>

            <div>
              <label className="label">Amount</label>
              <input type="number" step="0.01" min="0.01" className="input"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                onBlur={checkFraud}
                placeholder="100.00" required />
            </div>

            <div>
              <label className="label">Currency</label>
              <select className="input" value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                <option>USD</option><option>EUR</option><option>GBP</option>
                <option>BTC</option><option>ETH</option>
              </select>
            </div>

            <div>
              <label className="label">Nonce (auto-generated)</label>
              <input className="input font-mono text-xs" value={form.nonce} readOnly />
            </div>

            <div>
              <label className="label">Timestamp</label>
              <input className="input" value={form.timestamp}
                onChange={(e) => setForm({ ...form, timestamp: e.target.value })} />
            </div>
          </div>

          {/* Fraud assessment */}
          {fraud && (
            <div className="bg-gray-800 rounded-lg p-3 flex items-start gap-3">
              <Shield size={18} className={
                fraud.risk_level === 'HIGH' ? 'text-red-400' :
                fraud.risk_level === 'MEDIUM' ? 'text-yellow-400' : 'text-green-400'
              } />
              <div>
                <div className="flex items-center gap-2">
                  <span className={riskColor(fraud.risk_level)}>{fraud.risk_level} RISK</span>
                  <span className="text-xs text-gray-400">Score: {(fraud.risk_score * 100).toFixed(0)}%</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">{fraud.reason}</p>
              </div>
            </div>
          )}

          <div>
            <label className="label">Key ID</label>
            <select className="input" value={keyId}
              onChange={(e) => setKeyId(e.target.value)} required>
              <option value="">Select a key...</option>
              {keys.map((k) => (
                <option key={k.key_id} value={k.key_id}>
                  {k.key_id.slice(0, 8)}... ({k.algorithm})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Private Key (PEM) — used in-memory only</label>
            <textarea className="input font-mono text-xs h-32 resize-none"
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
              required />
            <p className="text-xs text-gray-500 mt-1">
              Your private key is sent over HTTPS and used only for signing. It is never stored.
            </p>
          </div>

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? 'Signing...' : 'Sign & Submit Transaction'}
          </button>
        </form>
      </div>

      {/* Result */}
      {result && (
        <div className="card border-green-800 bg-green-900/10">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle className="text-green-400" size={20} />
            <h3 className="font-semibold text-green-300">Transaction Signed</h3>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-400">Transaction ID</span>
              <code className="text-gray-200 text-xs">{result.id}</code>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Status</span>
              <span className="badge-yellow">{result.status}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Payload Hash</span>
              <code className="text-gray-400 text-xs">{result.payload_hash.slice(0, 16)}...</code>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
