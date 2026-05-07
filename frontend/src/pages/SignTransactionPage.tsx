/**
 * SignTransactionPage.tsx
 * =======================
 * Sign a transaction with:
 *  1. Face verification (FaceNet via webcam capture)
 *  2. ECDSA P-256 cryptographic signing
 *  3. Fraud risk assessment
 *
 * Flow: Fill form → Capture face → Submit → Backend verifies face → Signs
 */
import React, { useState, useEffect } from 'react'
import {
  Send, CheckCircle, Shield, ScanFace,
  AlertTriangle, Lock, ChevronRight, Copy, ExternalLink,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { txApi, keysApi, fraudApi, faceApi } from '../services/api'
import FaceCapture, { FaceCaptureResult } from '../components/FaceCapture'
import LivenessCapture, { LivenessCaptureResult } from '../components/LivenessCapture'
import { useNavigate } from 'react-router-dom'

function generateNonce() {
  // Cryptographically strong nonce: timestamp + random hex
  const ts  = Date.now().toString(36)
  const rnd = Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  return `${ts}${rnd}`   // e.g. "lq3k8f2a1b3c4d5e6f7g"
}

function freshTimestamp() {
  return new Date().toISOString().slice(0, 19)
}

interface FraudResult {
  risk_level: string
  risk_score: number
  reason: string
  recommended_action: string
}

type Step = 'form' | 'face' | 'submitting' | 'done'

export default function SignTransactionPage() {
  // ── Form state ──────────────────────────────────────────────────────────────
  const [form, setForm] = useState({
    receiver_id: '',
    amount: '',
    currency: 'INR',
    nonce: generateNonce(),
    timestamp: freshTimestamp(),
  })
  const [privateKey, setPrivateKey] = useState('')
  const [keyId, setKeyId]           = useState('')
  const [keys, setKeys]             = useState<any[]>([])

  // ── Face state ──────────────────────────────────────────────────────────────
  const [captured, setCaptured]     = useState<LivenessCaptureResult | null>(null)
  const [faceEnrolled, setFaceEnrolled] = useState<boolean | null>(null)

  // ── UI state ────────────────────────────────────────────────────────────────
  const [step, setStep]             = useState<Step>('form')
  const [result, setResult]         = useState<any>(null)
  const [fraud, setFraud]           = useState<FraudResult | null>(null)
  const [fraudLoading, setFraudLoading] = useState(false)
  const [faceVerifying, setFaceVerifying] = useState(false)
  const navigate = useNavigate()

  // Load keys + face enrollment status
  useEffect(() => {
    keysApi.list().then(({ data }) => setKeys(data)).catch(() => {})
    faceApi.status()
      .then(({ data }) => setFaceEnrolled(data.enrolled))
      .catch(() => setFaceEnrolled(false))
  }, [])

  // ── Fraud check ─────────────────────────────────────────────────────────────
  const checkFraud = async () => {
    if (!form.amount) return
    setFraudLoading(true)
    try {
      const { data } = await fraudApi.assess(parseFloat(form.amount), form.currency)
      setFraud(data)
    } catch { /* non-critical */ }
    finally { setFraudLoading(false) }
  }

  // ── Step 1: Validate form → go to face capture ──────────────────────────────
  const handleFormNext = (e: React.FormEvent) => {
    e.preventDefault()
    if (!privateKey.trim()) { toast.error('Private key is required'); return }
    if (!keyId)              { toast.error('Select a key ID'); return }
    if (!form.receiver_id)   { toast.error('Receiver ID is required'); return }
    if (!form.amount)        { toast.error('Amount is required'); return }

    if (faceEnrolled === false) {
      toast.error('Please enroll your face first in the Face Enrollment page', { duration: 5000 })
      return
    }

    // Always generate a fresh nonce + timestamp when entering the face step
    // This prevents replay errors if the user goes back and retries
    setForm((f) => ({
      ...f,
      nonce:     generateNonce(),
      timestamp: freshTimestamp(),
    }))
    setCaptured(null)
    setStep('face')
  }

  // ── Step 2: Submit with face ─────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!captured) {
      toast.error('Please capture your face before submitting')
      return
    }

    setStep('submitting')
    try {
      const { data } = await txApi.sign({
        receiver_id:     form.receiver_id,
        amount:          parseFloat(form.amount),
        currency:        form.currency,
        nonce:           form.nonce,
        timestamp:       form.timestamp,
        private_key_pem: privateKey,
        key_id:          keyId,
        face_blob:       captured.blob,
      })

      setResult(data)
      setStep('done')
      toast.success('Transaction signed and verified!')

    } catch (err: any) {
      const detail = err.response?.data?.detail || 'Signing failed'
      const status = err.response?.status

      if (status === 401 && detail.toLowerCase().includes('face')) {
        toast.error('Face verification failed — transaction blocked', { duration: 6000 })
        setCaptured(null)
        setForm((f) => ({ ...f, nonce: generateNonce(), timestamp: freshTimestamp() }))
        setStep('face')
      } else if (status === 404 && detail.toLowerCase().includes('face')) {
        toast.error('No face enrolled. Please enroll your face first.', { duration: 6000 })
        setForm((f) => ({ ...f, nonce: generateNonce(), timestamp: freshTimestamp() }))
        setStep('form')
      } else if (status === 409 && detail.toLowerCase().includes('nonce')) {
        // Nonce collision (extremely rare) — just regenerate silently and retry hint
        toast.error('Please try again (nonce refreshed)', { duration: 4000 })
        setCaptured(null)
        setForm((f) => ({ ...f, nonce: generateNonce(), timestamp: freshTimestamp() }))
        setStep('face')
      } else if (status === 429) {
        toast.error('Too many failed attempts. Please wait before trying again.', { duration: 8000 })
        setForm((f) => ({ ...f, nonce: generateNonce(), timestamp: freshTimestamp() }))
        setStep('form')
      } else {
        toast.error(detail)
        setCaptured(null)
        setForm((f) => ({ ...f, nonce: generateNonce(), timestamp: freshTimestamp() }))
        setStep('face')
      }
    }
  }

  const resetForm = () => {
    setStep('form')
    setResult(null)
    setCaptured(null)
    setFraud(null)
    setForm((f) => ({
      ...f,
      nonce:     generateNonce(),
      timestamp: freshTimestamp(),
    }))
  }

  const riskColor = (level: string) =>
    level === 'HIGH' ? 'badge-red' : level === 'MEDIUM' ? 'badge-yellow' : 'badge-green'

  // ── Step indicator ──────────────────────────────────────────────────────────
  const StepIndicator = () => (
    <div className="flex items-center gap-2 text-xs mb-6">
      {[
        { id: 'form', label: '1. Transaction Details', icon: Send },
        { id: 'face', label: '2. Face Verification', icon: ScanFace },
        { id: 'done', label: '3. Signed', icon: CheckCircle },
      ].map(({ id, label, icon: Icon }, i, arr) => (
        <React.Fragment key={id}>
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full transition-colors ${
            step === id || (step === 'submitting' && id === 'face')
              ? 'bg-blue-600/30 text-blue-300 border border-blue-700'
              : step === 'done' || (id === 'form' && step !== 'form')
              ? 'text-green-400'
              : 'text-gray-600'
          }`}>
            <Icon size={12} />
            <span>{label}</span>
          </div>
          {i < arr.length - 1 && (
            <ChevronRight size={12} className="text-gray-700 shrink-0" />
          )}
        </React.Fragment>
      ))}
    </div>
  )

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Send className="text-blue-400" size={24} />
          Sign Transaction
        </h1>
        <p className="text-gray-400 mt-1">
          Cryptographically sign with ECDSA P-256 + FaceNet biometric verification
        </p>
      </div>

      {/* Face enrollment warning */}
      {faceEnrolled === false && (
        <div className="card border-yellow-700 bg-yellow-900/10 flex items-start gap-3">
          <AlertTriangle className="text-yellow-400 shrink-0 mt-0.5" size={18} />
          <div>
            <p className="text-yellow-300 font-medium text-sm">Face not enrolled</p>
            <p className="text-yellow-400/70 text-xs mt-0.5">
              Go to <strong>Face Enrollment</strong> in the sidebar to enroll your face before signing.
            </p>
          </div>
        </div>
      )}

      <div className="card">
        <StepIndicator />

        {/* ── STEP 1: Transaction form ── */}
        {step === 'form' && (
          <form onSubmit={handleFormNext} className="space-y-4">
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
                  placeholder="1000.00" required />
              </div>

              <div>
                <label className="label">Currency</label>
                <select className="input" value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}>
                  <option value="INR">INR — Indian Rupee (₹)</option>
                  <option value="USD">USD — US Dollar ($)</option>
                  <option value="EUR">EUR — Euro (€)</option>
                  <option value="GBP">GBP — British Pound (£)</option>
                  <option value="BTC">BTC — Bitcoin</option>
                  <option value="ETH">ETH — Ethereum</option>
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
                    <span className="text-xs text-gray-400">
                      Score: {(fraud.risk_score * 100).toFixed(0)}%
                    </span>
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
              <textarea className="input font-mono text-xs h-28 resize-none"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                required />
              <p className="text-xs text-gray-500 mt-1">
                <Lock size={10} className="inline mr-1" />
                Used only for signing — never stored or transmitted in plaintext.
              </p>
            </div>

            <button
              type="submit"
              disabled={faceEnrolled === false}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              Next: Verify Face <ScanFace size={16} />
            </button>
          </form>
        )}

        {/* ── STEP 2: Face capture ── */}
        {(step === 'face' || step === 'submitting') && (
          <div className="space-y-4">
            <div className="bg-blue-900/20 border border-blue-800/40 rounded-lg p-3 text-xs text-blue-300">
              <p className="font-medium flex items-center gap-1.5 mb-1">
                <ScanFace size={13} /> Face Verification Required
              </p>
              <p className="text-blue-300/70">
                Your face will be compared against your enrolled embedding using FaceNet.
                The image is processed in-memory and never stored.
              </p>
            </div>

            <LivenessCapture
              captured={captured}
              onCapture={setCaptured}
              onClear={() => setCaptured(null)}
              label="Liveness Verification (Anti-Spoofing)"
            />

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => { setStep('form'); setCaptured(null) }}
                disabled={step === 'submitting'}
                className="btn-secondary flex-1"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!captured || step === 'submitting'}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
                {step === 'submitting' ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Verifying & Signing...
                  </>
                ) : (
                  <>
                    <Send size={16} /> Sign Transaction
                  </>
                )}
              </button>
            </div>

            {step === 'submitting' && (
              <div className="text-center text-xs text-gray-400 space-y-1">
                <p>🔍 Verifying face with FaceNet...</p>
                <p>🔐 Signing with ECDSA P-256...</p>
              </div>
            )}
          </div>
        )}

        {/* ── STEP 3: Success ── */}
        {step === 'done' && result && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-green-900/20 border border-green-800 rounded-xl">
              <CheckCircle className="text-green-400 shrink-0" size={28} />
              <div>
                <p className="font-bold text-green-300">Transaction Signed Successfully</p>
                <p className="text-xs text-green-400/70 mt-0.5">
                  Face verified · ECDSA signed · Stored securely
                </p>
              </div>
            </div>

            <div className="space-y-3 text-sm bg-gray-800/50 rounded-lg p-4">
              {/* Full Transaction ID with copy */}
              <div>
                <p className="text-gray-400 text-xs mb-1">Transaction ID</p>
                <div className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-2">
                  <code className="text-blue-300 text-xs font-mono flex-1 break-all select-all">
                    {result.id}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(result.id)
                      toast.success('Transaction ID copied!')
                    }}
                    className="text-gray-500 hover:text-blue-400 transition-colors shrink-0"
                    title="Copy Transaction ID"
                  >
                    <Copy size={14} />
                  </button>
                </div>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-gray-400">Status</span>
                <span className="badge-yellow">{result.status}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Amount</span>
                <span className="text-white font-mono font-semibold">
                  {result.amount.toLocaleString('en-IN')} {result.currency}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-400">Payload Hash</span>
                <code className="text-gray-400 text-xs font-mono">
                  {result.payload_hash.slice(0, 16)}...
                </code>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => navigate(`/verify?id=${result.id}`)}
                className="btn-secondary flex-1 flex items-center justify-center gap-2"
              >
                <ExternalLink size={15} /> Verify Now
              </button>
              <button onClick={resetForm} className="btn-primary flex-1">
                Sign Another
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
