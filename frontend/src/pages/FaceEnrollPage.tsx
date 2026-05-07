/**
 * FaceEnrollPage.tsx
 * ==================
 * - Forces face enrollment on first login (face_registered=false)
 * - Secure delete: user must verify face BEFORE deletion is allowed
 * - Cannot skip enrollment if coming from first login
 */
import React, { useState, useEffect } from 'react'
import {
  ScanFace, CheckCircle, AlertTriangle, ShieldAlert,
  RefreshCw, Trash2, ShieldX,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useNavigate, useSearchParams } from 'react-router-dom'
import FaceCapture, { FaceCaptureResult } from '../components/FaceCapture'
import { faceApi } from '../services/api'
import { useAuth } from '../context/AuthContext'
import { format } from 'date-fns'

interface FaceStatus {
  enrolled:    boolean
  model_name?: string
  enrolled_at?: string
}

type Mode = 'view' | 'enroll' | 'delete-verify'

export default function FaceEnrollPage() {
  const { faceRegistered, setFaceRegistered } = useAuth()
  const [searchParams]  = useSearchParams()
  const isForced        = searchParams.get('required') === 'true'
  const navigate        = useNavigate()

  const [status, setStatus]       = useState<FaceStatus | null>(null)
  const [mode, setMode]           = useState<Mode>('view')
  const [captured, setCaptured]   = useState<FaceCaptureResult | null>(null)
  const [loading, setLoading]     = useState(false)
  const [checking, setChecking]   = useState(true)

  useEffect(() => {
    faceApi.status()
      .then(({ data }) => {
        setStatus(data)
        // If forced (first login) and not enrolled, go straight to enroll mode
        if (isForced && !data.enrolled) setMode('enroll')
      })
      .catch(() => setStatus({ enrolled: false }))
      .finally(() => setChecking(false))
  }, [isForced])

  // ── Enroll ──────────────────────────────────────────────────────────────────
  const handleEnroll = async () => {
    if (!captured) { toast.error('Please capture your face first'); return }
    setLoading(true)
    try {
      await faceApi.enroll(captured.blob)
      toast.success('Face enrolled successfully!')
      setFaceRegistered(true)
      const { data: s } = await faceApi.status()
      setStatus(s)
      setCaptured(null)
      setMode('view')
      if (isForced) navigate('/transactions')
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Enrollment failed')
    } finally {
      setLoading(false)
    }
  }

  // ── Secure Delete — requires live face verification ─────────────────────────
  const handleSecureDelete = async () => {
    if (!captured) { toast.error('Please capture your face to verify identity'); return }
    setLoading(true)
    try {
      await faceApi.remove(captured.blob)
      toast.success('Face enrollment deleted after verification')
      setFaceRegistered(false)
      setStatus({ enrolled: false })
      setCaptured(null)
      setMode('view')
    } catch (err: any) {
      const detail = err.response?.data?.detail || 'Deletion failed'
      const status = err.response?.status
      if (status === 401) {
        toast.error('Face verification failed — deletion denied', { duration: 6000 })
      } else if (status === 429) {
        toast.error('Too many failed attempts. Try again later.', { duration: 8000 })
      } else {
        toast.error(detail)
      }
      setCaptured(null)
    } finally {
      setLoading(false)
    }
  }

  if (checking) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-blue-400" size={28} />
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">

      {/* ── Forced enrollment banner ── */}
      {isForced && !status?.enrolled && (
        <div className="card border-red-700 bg-red-900/10 flex items-start gap-3">
          <ShieldAlert className="text-red-400 shrink-0 mt-0.5" size={20} />
          <div>
            <p className="text-red-300 font-semibold">Face Registration Required</p>
            <p className="text-red-400/70 text-xs mt-1">
              You must register your face before using the system.
              This is a one-time security setup.
            </p>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <ScanFace className="text-blue-400" size={24} />
          Face Enrollment
        </h1>
        <p className="text-gray-400 mt-1">
          Biometric identity for secure transaction signing
        </p>
      </div>

      {/* ── Status card ── */}
      <div className="card">
        <h2 className="font-semibold text-white mb-3">Enrollment Status</h2>
        {status?.enrolled ? (
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <CheckCircle className="text-green-400 mt-0.5 shrink-0" size={20} />
              <div>
                <p className="text-green-300 font-medium">Face enrolled</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Model: {status.model_name} ·{' '}
                  {status.enrolled_at
                    ? `Enrolled ${format(new Date(status.enrolled_at), 'MMM d, yyyy HH:mm')}`
                    : ''}
                </p>
              </div>
            </div>
            {mode === 'view' && (
              <div className="flex gap-2">
                <button onClick={() => { setMode('enroll'); setCaptured(null) }}
                  className="btn-secondary text-xs py-1 px-3">
                  Update
                </button>
                <button
                  onClick={() => { setMode('delete-verify'); setCaptured(null) }}
                  className="flex items-center gap-1 text-xs px-3 py-1 rounded-lg
                             bg-red-900/30 hover:bg-red-900/50 text-red-400 border border-red-800
                             transition-colors">
                  <Trash2 size={13} /> Delete
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <AlertTriangle className="text-yellow-400 shrink-0" size={20} />
            <div>
              <p className="text-yellow-300 font-medium">Not enrolled</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Enroll your face to enable biometric transaction signing
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── Enroll mode ── */}
      {(mode === 'enroll' || (!status?.enrolled && mode === 'view')) && (
        <div className="card space-y-4">
          <h2 className="font-semibold text-white">
            {status?.enrolled ? 'Update Face Enrollment' : 'Register Your Face'}
          </h2>

          <div className="bg-blue-900/20 border border-blue-800/40 rounded-lg p-3 text-xs text-blue-300 space-y-1">
            <p className="font-medium">Tips for best results:</p>
            <ul className="list-disc list-inside space-y-0.5 text-blue-300/80">
              <li>Face the camera directly in good lighting</li>
              <li>Only one face should be visible</li>
              <li>Your raw image is never stored — only a mathematical embedding</li>
            </ul>
          </div>

          <FaceCapture
            captured={captured}
            onCapture={setCaptured}
            onClear={() => setCaptured(null)}
            label="Capture Face for Enrollment"
            required
          />

          <div className="flex gap-3">
            {mode === 'enroll' && status?.enrolled && (
              <button onClick={() => { setMode('view'); setCaptured(null) }}
                className="btn-secondary flex-1">Cancel</button>
            )}
            <button onClick={handleEnroll} disabled={!captured || loading}
              className="btn-primary flex-1 flex items-center justify-center gap-2">
              {loading
                ? <><RefreshCw size={15} className="animate-spin" /> Enrolling...</>
                : <><ScanFace size={15} /> {status?.enrolled ? 'Update' : 'Enroll Face'}</>}
            </button>
          </div>
        </div>
      )}

      {/* ── Secure Delete mode — requires face verification ── */}
      {mode === 'delete-verify' && (
        <div className="card border-red-800 bg-red-900/10 space-y-4">
          <div className="flex items-start gap-3">
            <ShieldX className="text-red-400 shrink-0 mt-0.5" size={20} />
            <div>
              <h2 className="font-semibold text-red-300">Verify Identity to Delete</h2>
              <p className="text-xs text-red-400/70 mt-1">
                For security, you must verify your face before deleting your enrollment.
                Capture your face below — it must match your registered face.
              </p>
            </div>
          </div>

          <FaceCapture
            captured={captured}
            onCapture={setCaptured}
            onClear={() => setCaptured(null)}
            label="Capture Face to Verify Identity"
            required
          />

          <div className="flex gap-3">
            <button onClick={() => { setMode('view'); setCaptured(null) }}
              className="btn-secondary flex-1">Cancel</button>
            <button
              onClick={handleSecureDelete}
              disabled={!captured || loading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2
                         bg-red-700 hover:bg-red-600 text-white font-semibold rounded-lg
                         transition-colors disabled:opacity-50">
              {loading
                ? <><RefreshCw size={15} className="animate-spin" /> Verifying...</>
                : <><Trash2 size={15} /> Verify & Delete</>}
            </button>
          </div>
        </div>
      )}

    </div>
  )
}
