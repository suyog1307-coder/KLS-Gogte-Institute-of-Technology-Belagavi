/**
 * FaceCapture.tsx
 * ===============
 * Reusable webcam face capture component.
 *
 * Features:
 *  - Live webcam preview via getUserMedia
 *  - Capture snapshot as JPEG blob
 *  - Preview captured image
 *  - Retake support
 *  - Clear error states
 *  - Accessible (keyboard + screen reader friendly)
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, CameraOff, RefreshCw, CheckCircle, AlertCircle, Video } from 'lucide-react'

export interface FaceCaptureResult {
  blob: Blob          // JPEG blob ready to send as FormData
  dataUrl: string     // base64 data URL for preview
}

interface FaceCaptureProps {
  onCapture: (result: FaceCaptureResult) => void
  onClear?: () => void
  captured: FaceCaptureResult | null
  label?: string
  required?: boolean
}

type CameraState = 'idle' | 'starting' | 'active' | 'error'

export default function FaceCapture({
  onCapture,
  onClear,
  captured,
  label = 'Face Verification',
  required = true,
}: FaceCaptureProps) {
  const videoRef   = useRef<HTMLVideoElement>(null)
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const streamRef  = useRef<MediaStream | null>(null)

  const [camState, setCamState]   = useState<CameraState>('idle')
  const [camError, setCamError]   = useState<string>('')
  const [countdown, setCountdown] = useState<number>(0)

  // ── Stop camera stream ──────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
    setCamState('idle')
  }, [])

  // Cleanup on unmount
  useEffect(() => () => stopCamera(), [stopCamera])

  // ── Start camera ────────────────────────────────────────────────────────────
  const startCamera = async () => {
    setCamError('')
    setCamState('starting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCamState('active')
    } catch (err: any) {
      const msg =
        err.name === 'NotAllowedError'
          ? 'Camera permission denied. Please allow camera access in your browser.'
          : err.name === 'NotFoundError'
          ? 'No camera found on this device.'
          : `Camera error: ${err.message}`
      setCamError(msg)
      setCamState('error')
    }
  }

  // ── Capture frame ───────────────────────────────────────────────────────────
  const captureFrame = useCallback(() => {
    const video  = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || camState !== 'active') return

    canvas.width  = video.videoWidth  || 640
    canvas.height = video.videoHeight || 480

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Mirror the image (selfie view)
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    ctx.setTransform(1, 0, 0, 1, 0, 0)

    canvas.toBlob(
      (blob) => {
        if (!blob) return
        const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
        onCapture({ blob, dataUrl })
        stopCamera()
      },
      'image/jpeg',
      0.92,
    )
  }, [camState, onCapture, stopCamera])

  // ── Countdown capture (3-2-1) ───────────────────────────────────────────────
  const startCountdown = () => {
    let count = 3
    setCountdown(count)
    const interval = setInterval(() => {
      count -= 1
      setCountdown(count)
      if (count === 0) {
        clearInterval(interval)
        setCountdown(0)
        captureFrame()
      }
    }, 1000)
  }

  // ── Retake ──────────────────────────────────────────────────────────────────
  const retake = () => {
    onClear?.()
    startCamera()
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="label flex items-center gap-2">
          <Camera size={14} className="text-blue-400" />
          {label}
          {required && <span className="text-red-400 text-xs">*required</span>}
        </label>
        {captured && (
          <span className="badge-green">
            <CheckCircle size={12} /> Captured
          </span>
        )}
      </div>

      {/* ── Captured preview ── */}
      {captured ? (
        <div className="relative rounded-xl overflow-hidden border border-green-700 bg-gray-900">
          <img
            src={captured.dataUrl}
            alt="Captured face"
            className="w-full max-h-56 object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute bottom-3 left-0 right-0 flex justify-center">
            <button
              type="button"
              onClick={retake}
              className="btn-secondary flex items-center gap-2 text-sm py-1.5 px-4"
            >
              <RefreshCw size={14} /> Retake
            </button>
          </div>
          <div className="absolute top-3 right-3">
            <span className="badge-green text-xs">
              <CheckCircle size={11} /> Face captured
            </span>
          </div>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden border border-gray-700 bg-gray-900">
          {/* ── Live video ── */}
          <div className="relative aspect-video bg-gray-950 flex items-center justify-center">
            <video
              ref={videoRef}
              className={`w-full h-full object-cover ${camState === 'active' ? 'block' : 'hidden'}`}
              style={{ transform: 'scaleX(-1)' }}   // mirror for selfie
              muted
              playsInline
              aria-label="Live camera feed"
            />

            {/* Overlay when camera not active */}
            {camState !== 'active' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-500">
                {camState === 'starting' ? (
                  <>
                    <Video size={36} className="animate-pulse text-blue-400" />
                    <p className="text-sm">Starting camera...</p>
                  </>
                ) : camState === 'error' ? (
                  <>
                    <CameraOff size={36} className="text-red-400" />
                    <p className="text-sm text-red-400 text-center px-4">{camError}</p>
                  </>
                ) : (
                  <>
                    <Camera size={36} />
                    <p className="text-sm">Camera not started</p>
                  </>
                )}
              </div>
            )}

            {/* Face guide overlay */}
            {camState === 'active' && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-44 h-56 rounded-full border-2 border-blue-400/60 border-dashed" />
              </div>
            )}

            {/* Countdown */}
            {countdown > 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-7xl font-bold text-white drop-shadow-lg animate-ping">
                  {countdown}
                </span>
              </div>
            )}
          </div>

          {/* ── Controls ── */}
          <div className="p-3 flex gap-2 justify-center bg-gray-900/80">
            {camState === 'idle' || camState === 'error' ? (
              <button
                type="button"
                onClick={startCamera}
                className="btn-primary flex items-center gap-2 text-sm"
              >
                <Video size={16} /> Start Camera
              </button>
            ) : camState === 'active' ? (
              <>
                <button
                  type="button"
                  onClick={startCountdown}
                  disabled={countdown > 0}
                  className="btn-primary flex items-center gap-2 text-sm"
                >
                  <Camera size={16} />
                  {countdown > 0 ? `Capturing in ${countdown}...` : 'Capture Face'}
                </button>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="btn-secondary text-sm"
                >
                  Cancel
                </button>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} className="hidden" aria-hidden="true" />

      {/* Helper text */}
      {!captured && camState !== 'active' && (
        <p className="text-xs text-gray-500">
          Position your face in the oval guide. Ensure good lighting and look directly at the camera.
        </p>
      )}
    </div>
  )
}
