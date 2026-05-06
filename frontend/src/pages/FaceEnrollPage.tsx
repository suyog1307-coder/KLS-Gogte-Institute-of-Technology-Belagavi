/**
 * FaceEnrollPage.tsx
 * ==================
 * Enroll or re-enroll your face for transaction signing.
 * Shows current enrollment status and allows updating.
 */
import React, { useState, useEffect } from 'react'
import { ScanFace, CheckCircle, AlertTriangle, Trash2, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import FaceCapture, { FaceCaptureResult } from '../components/FaceCapture'
import { faceApi } from '../services/api'
import { format } from 'date-fns'

interface FaceStatus {
  enrolled: boolean
  model_name?: string
  enrolled_at?: string
}

export default function FaceEnrollPage() {
  const [status, setStatus]     = useState<FaceStatus | null>(null)
  const [captured, setCaptured] = useState<FaceCaptureResult | null>(null)
  const [loading, setLoading]   = useState(false)
  const [checking, setChecking] = useState(true)

  // Load current enrollment status
  useEffect(() => {
    faceApi.status()
      .then(({ data }) => setStatus(data))
      .catch(() => setStatus({ enrolled: false }))
      .finally(() => setChecking(false))
  }, [])

  const handleEnroll = async () => {
    if (!captured) {
      toast.error('Please capture your face first')
      return
    }
    setLoading(true)
    try {
      const { data } = await faceApi.enroll(captured.blob)
      toast.success(data.message)
      // Refresh status
      const { data: s } = await faceApi.status()
      setStatus(s)
      setCaptured(null)
    } catch (err: any) {
      const detail = err.response?.data?.detail || 'Enrollment failed'
      toast.error(detail)
    } finally {
      setLoading(false)
    }
  }

  const handleRemove = async () => {
    if (!confirm('Remove your face enrollment? You will need to re-enroll to sign transactions.')) return
    setLoading(true)
    try {
      await faceApi.remove()
      toast.success('Face enrollment removed')
      setStatus({ enrolled: false })
    } catch (err: any) {
      toast.error(err.response?.data?.detail || 'Failed to remove enrollment')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <ScanFace className="text-blue-400" size={24} />
          Face Enrollment
        </h1>
        <p className="text-gray-400 mt-1">
          Enroll your face to enable biometric transaction signing
        </p>
      </div>

      {/* Current status */}
      <div className="card">
        <h2 className="font-semibold text-white mb-3">Enrollment Status</h2>
        {checking ? (
          <p className="text-gray-500 text-sm">Checking...</p>
        ) : status?.enrolled ? (
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
            <button
              onClick={handleRemove}
              disabled={loading}
              className="text-red-400 hover:text-red-300 transition-colors p-1"
              title="Remove enrollment"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <AlertTriangle className="text-yellow-400 shrink-0" size={20} />
            <div>
              <p className="text-yellow-300 font-medium">Not enrolled</p>
              <p className="text-xs text-gray-400 mt-0.5">
                You must enroll your face before signing transactions
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Enrollment form */}
      <div className="card space-y-4">
        <h2 className="font-semibold text-white">
          {status?.enrolled ? 'Update Face Enrollment' : 'Enroll Your Face'}
        </h2>

        <div className="bg-blue-900/20 border border-blue-800/40 rounded-lg p-3 text-xs text-blue-300 space-y-1">
          <p className="font-medium">Tips for best results:</p>
          <ul className="list-disc list-inside space-y-0.5 text-blue-300/80">
            <li>Face the camera directly in good lighting</li>
            <li>Remove glasses or hats if possible</li>
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

        <button
          onClick={handleEnroll}
          disabled={!captured || loading}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {loading ? (
            <><RefreshCw size={16} className="animate-spin" /> Enrolling...</>
          ) : (
            <><ScanFace size={16} /> {status?.enrolled ? 'Update Enrollment' : 'Enroll Face'}</>
          )}
        </button>
      </div>
    </div>
  )
}
