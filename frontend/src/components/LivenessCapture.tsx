/**
 * LivenessCapture.tsx
 * ===================
 * Webcam face capture with liveness detection.
 *
 * Behaviour:
 *  - Camera starts automatically when component mounts
 *  - User must MANUALLY click "Capture" — NO auto-capture
 *  - Button is disabled until face is detected AND challenge is completed
 *  - Challenge: blink once (EAR < 0.21) OR look at camera for 2 seconds
 *  - Shows clear status: "Position face" → "Blink once" → "Ready — click Capture"
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Camera, Eye, AlertTriangle, CheckCircle,
  RefreshCw, ShieldCheck, ShieldX, Activity,
} from 'lucide-react'

export interface LivenessCaptureResult {
  blob:          Blob
  dataUrl:       string
  frames:        string[]
  challengeId:   string
  blinkDetected: boolean
  headYaw:       number
}

interface Props {
  onCapture: (result: LivenessCaptureResult) => void
  onClear?:  () => void
  captured:  LivenessCaptureResult | null
  label?:    string
}

// MediaPipe landmark indices for eyes
const LEFT_EYE  = [33, 160, 158, 133, 153, 144]
const RIGHT_EYE = [362, 385, 387, 263, 373, 380]

function calcEAR(pts: { x: number; y: number }[]): number {
  if (pts.length < 6) return 0.3
  const d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
  const A = d(pts[1], pts[5]), B = d(pts[2], pts[4]), C = d(pts[0], pts[3])
  return C < 0.001 ? 0.3 : (A + B) / (2 * C)
}

export default function LivenessCapture({ onCapture, onClear, captured, label }: Props) {
  const videoRef  = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const mpRef     = useRef<any>(null)
  const animRef   = useRef<number>(0)
  const framesRef = useRef<string[]>([])
  const blinkRef  = useRef(false)

  // How long the face has been in frame (for "look at camera" challenge)
  const faceTimeRef = useRef(0)
  const lastFrameRef = useRef(0)

  const [camError,     setCamError]     = useState('')
  const [started,      setStarted]      = useState(false)
  const [faceDetected, setFaceDetected] = useState(false)
  const [blinkDone,    setBlinkDone]    = useState(false)
  const [earValue,     setEarValue]     = useState(0.3)
  const [headYaw,      setHeadYaw]      = useState(0)
  const [blinkCount,   setBlinkCount]   = useState(0)
  const [faceSeconds,  setFaceSeconds]  = useState(0)  // seconds face has been in frame
  const [capturing,    setCapturing]    = useState(false)

  // Challenge is complete when: blinked once OR face in frame for 3 seconds
  const FACE_HOLD_SECONDS = 3
  const challengeDone = blinkDone || faceSeconds >= FACE_HOLD_SECONDS
  const readyToCapture = faceDetected && challengeDone

  // ── Stop camera ─────────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    cancelAnimationFrame(animRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setStarted(false)
    setFaceDetected(false)
    setBlinkDone(false)
    setBlinkCount(0)
    setFaceSeconds(0)
    faceTimeRef.current = 0
    blinkRef.current = false
  }, [])

  useEffect(() => () => stopCamera(), [stopCamera])

  // Auto-start on mount (only if not already captured)
  useEffect(() => {
    if (!captured) startCamera()
  }, []) // eslint-disable-line

  // ── Start camera ─────────────────────────────────────────────────────────────
  const startCamera = async () => {
    setCamError('')
    setBlinkDone(false)
    setBlinkCount(0)
    setFaceSeconds(0)
    setFaceDetected(false)
    faceTimeRef.current = 0
    blinkRef.current = false
    framesRef.current = []

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
      setStarted(true)
      initMediaPipe()
    } catch (err: any) {
      setCamError(
        err.name === 'NotAllowedError' ? 'Camera permission denied. Please allow camera access in your browser.' :
        err.name === 'NotFoundError'   ? 'No camera found on this device.' :
        `Camera error: ${err.message}`
      )
    }
  }

  // ── MediaPipe ────────────────────────────────────────────────────────────────
  const initMediaPipe = async () => {
    try {
      // @ts-ignore
      const { FaceMesh } = await import('@mediapipe/face_mesh')
      const fm = new FaceMesh({
        locateFile: (f: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
      })
      fm.setOptions({
        maxNumFaces: 1, refineLandmarks: true,
        minDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
      })
      fm.onResults(onResults)
      mpRef.current = fm
    } catch {
      console.warn('MediaPipe unavailable — basic mode')
    }
    runLoop()
  }

  const runLoop = () => {
    const loop = async () => {
      if (!videoRef.current || !streamRef.current) return
      if (mpRef.current) {
        try { await mpRef.current.send({ image: videoRef.current }) } catch { /* ok */ }
      }
      bufferFrame()
      animRef.current = requestAnimationFrame(loop)
    }
    animRef.current = requestAnimationFrame(loop)
  }

  // ── MediaPipe results ─────────────────────────────────────────────────────────
  const onResults = (results: any) => {
    const canvas = canvasRef.current
    const video  = videoRef.current
    if (!canvas || !video) return

    const ctx = canvas.getContext('2d')!
    canvas.width  = video.videoWidth  || 640
    canvas.height = video.videoHeight || 480
    const W = canvas.width, H = canvas.height

    // Mirror draw
    ctx.save()
    ctx.translate(W, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0, W, H)
    ctx.restore()

    if (!results.multiFaceLandmarks?.length) {
      setFaceDetected(false)
      faceTimeRef.current = 0
      setFaceSeconds(0)
      return
    }

    setFaceDetected(true)

    // Track how long face has been in frame
    const now = Date.now()
    if (lastFrameRef.current > 0) {
      const delta = (now - lastFrameRef.current) / 1000
      faceTimeRef.current = Math.min(faceTimeRef.current + delta, FACE_HOLD_SECONDS)
      setFaceSeconds(Math.floor(faceTimeRef.current))
    }
    lastFrameRef.current = now

    const lm = results.multiFaceLandmarks[0]

    // Face mesh dots
    ctx.fillStyle = 'rgba(0,200,255,0.3)'
    lm.forEach((p: any) => {
      ctx.beginPath()
      ctx.arc(p.x * W, p.y * H, 1.2, 0, 2 * Math.PI)
      ctx.fill()
    })

    // EAR blink detection
    const lPts = LEFT_EYE.map(i  => ({ x: lm[i].x * W, y: lm[i].y * H }))
    const rPts = RIGHT_EYE.map(i => ({ x: lm[i].x * W, y: lm[i].y * H }))
    const ear  = (calcEAR(lPts) + calcEAR(rPts)) / 2
    setEarValue(ear)

    // Blink: EAR drops below 0.21 then rises above 0.25
    if (ear < 0.21 && !blinkRef.current) {
      blinkRef.current = true
      setBlinkCount(c => c + 1)
      setBlinkDone(true)
    } else if (ear > 0.25) {
      blinkRef.current = false
    }

    // Head yaw
    const nose = lm[1], lE = lm[33], rE = lm[263]
    const midX = (lE.x + rE.x) / 2
    const eyeD = Math.abs(rE.x - lE.x)
    const yaw  = eyeD > 0.01 ? ((nose.x - midX) / eyeD) * 45 : 0
    setHeadYaw(yaw)

    // Eye outlines
    ctx.strokeStyle = ear < 0.21 ? '#ff4444' : '#00ff88'
    ctx.lineWidth = 1.5
    ;[lPts, rPts].forEach(pts => {
      ctx.beginPath()
      pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
      ctx.closePath()
      ctx.stroke()
    })

    // Face oval — color changes with readiness
    const ovalColor = (blinkDone || faceTimeRef.current >= FACE_HOLD_SECONDS)
      ? 'rgba(34,197,94,0.7)'
      : 'rgba(251,191,36,0.5)'
    ctx.strokeStyle = ovalColor
    ctx.lineWidth = 2
    ctx.setLineDash([6, 4])
    ctx.beginPath()
    ctx.ellipse(W / 2, H / 2, W * 0.22, H * 0.35, 0, 0, 2 * Math.PI)
    ctx.stroke()
    ctx.setLineDash([])
  }

  // ── Buffer frames ─────────────────────────────────────────────────────────────
  const bufferFrame = () => {
    const v = videoRef.current
    if (!v || v.readyState < 2) return
    const tmp = document.createElement('canvas')
    tmp.width = v.videoWidth || 320; tmp.height = v.videoHeight || 240
    const ctx = tmp.getContext('2d')!
    ctx.translate(tmp.width, 0); ctx.scale(-1, 1)
    ctx.drawImage(v, 0, 0)
    framesRef.current.push(tmp.toDataURL('image/jpeg', 0.4).split(',')[1])
    if (framesRef.current.length > 8) framesRef.current.shift()
  }

  // ── Manual capture (user clicks button) ──────────────────────────────────────
  const doCapture = () => {
    if (!readyToCapture || capturing) return
    setCapturing(true)

    const canvas = canvasRef.current
    if (!canvas) return

    canvas.toBlob(blob => {
      if (!blob) { setCapturing(false); return }
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
      onCapture({
        blob,
        dataUrl,
        frames:        [...framesRef.current],
        challengeId:   blinkDone ? 'blink' : 'forward',
        blinkDetected: blinkDone,
        headYaw,
      })
      stopCamera()
      setCapturing(false)
    }, 'image/jpeg', 0.92)
  }

  // ── Status message ────────────────────────────────────────────────────────────
  const getStatus = () => {
    if (!faceDetected) return { msg: 'Position your face in the oval', color: 'text-gray-400', icon: '👤' }
    if (blinkDone)     return { msg: 'Liveness confirmed — click Capture', color: 'text-green-400', icon: '✓' }
    if (faceSeconds >= FACE_HOLD_SECONDS) return { msg: 'Ready — click Capture', color: 'text-green-400', icon: '✓' }
    return {
      msg: `Blink once to confirm liveness (or hold still ${FACE_HOLD_SECONDS - faceSeconds}s)`,
      color: 'text-yellow-400',
      icon: '👁',
    }
  }

  const status = getStatus()

  // ── Captured preview ──────────────────────────────────────────────────────────
  if (captured) {
    return (
      <div className="space-y-2">
        {label && <label className="label">{label}</label>}
        <div className="relative rounded-xl overflow-hidden border border-green-700/60 bg-gray-900">
          <img src={captured.dataUrl} alt="Captured face"
            className="w-full max-h-56 object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
          <div className="absolute top-3 left-3">
            <span className="badge-green text-xs flex items-center gap-1">
              <CheckCircle size={11} /> Face captured
            </span>
          </div>
          <div className="absolute bottom-3 left-0 right-0 flex justify-center">
            <button type="button"
              onClick={() => { onClear?.(); stopCamera(); setTimeout(startCamera, 100) }}
              className="btn-secondary text-sm py-1.5 px-4 flex items-center gap-2">
              <RefreshCw size={14} /> Retake
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Camera view ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-2">
      {label && (
        <label className="label flex items-center gap-2">
          <ShieldCheck size={14} className="text-blue-400" /> {label}
        </label>
      )}

      <div className="rounded-xl overflow-hidden border border-gray-700/60 bg-gray-900">

        {/* Video area */}
        <div className="relative aspect-video bg-gray-950 flex items-center justify-center">
          <video ref={videoRef} className="hidden" muted playsInline />
          <canvas ref={canvasRef}
            className={`w-full h-full object-cover ${started ? 'block' : 'hidden'}`} />

          {/* Not started / error */}
          {!started && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              {camError ? (
                <>
                  <AlertTriangle size={32} className="text-red-400" />
                  <p className="text-sm text-red-400 text-center px-6 max-w-xs">{camError}</p>
                  <button onClick={startCamera} className="btn-primary text-sm">
                    Try Again
                  </button>
                </>
              ) : (
                <>
                  <Camera size={32} className="animate-pulse text-blue-400" />
                  <p className="text-sm text-gray-400">Starting camera...</p>
                </>
              )}
            </div>
          )}

          {/* Ready flash overlay */}
          {readyToCapture && started && (
            <div className="absolute top-3 right-3">
              <span className="badge-green text-xs animate-pulse">
                ✓ Ready
              </span>
            </div>
          )}
        </div>

        {/* Status bar */}
        {started && (
          <div className="px-4 py-3 bg-gray-900 border-t border-gray-800 space-y-2">

            {/* Main instruction */}
            <p className={`text-sm font-medium text-center ${status.color}`}>
              {status.icon} {status.msg}
            </p>

            {/* Face hold progress bar */}
            {faceDetected && !blinkDone && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Hold still</span>
                  <span>{faceSeconds}/{FACE_HOLD_SECONDS}s</span>
                </div>
                <div className="w-full bg-gray-800 rounded-full h-1.5">
                  <div
                    className="h-1.5 rounded-full bg-yellow-500 transition-all duration-1000"
                    style={{ width: `${(faceSeconds / FACE_HOLD_SECONDS) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Stats row */}
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <Eye size={11} className={earValue < 0.21 ? 'text-red-400' : 'text-green-400'} />
                EAR {earValue.toFixed(2)}
              </span>
              <span className="flex items-center gap-1">
                <Activity size={11} />
                Blinks: {blinkCount}
              </span>
              <span>Yaw: {headYaw.toFixed(0)}°</span>
              <span className={`flex items-center gap-1 ${faceDetected ? 'text-green-400' : 'text-gray-600'}`}>
                {faceDetected
                  ? <><ShieldCheck size={11} /> Live</>
                  : <><ShieldX size={11} /> No face</>}
              </span>
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="p-3 flex gap-2 justify-center bg-gray-900/80 border-t border-gray-800">
          {!started && !camError && (
            <p className="text-sm text-gray-500 flex items-center gap-2">
              <Camera size={14} className="animate-pulse" /> Starting...
            </p>
          )}

          {started && (
            <>
              {/* CAPTURE button — only enabled when ready */}
              <button
                type="button"
                onClick={doCapture}
                disabled={!readyToCapture || capturing}
                className={`flex items-center gap-2 px-5 py-2 rounded-xl font-semibold
                             text-sm transition-all duration-150 active:scale-95
                             ${readyToCapture && !capturing
                               ? 'bg-gradient-to-r from-green-600 to-emerald-500 text-white shadow-lg shadow-green-900/30 hover:from-green-500 hover:to-emerald-400'
                               : 'bg-gray-800 text-gray-500 cursor-not-allowed border border-gray-700'
                             }`}
              >
                {capturing ? (
                  <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Capturing...</>
                ) : readyToCapture ? (
                  <><CheckCircle size={16} /> Capture Face</>
                ) : (
                  <><Camera size={16} /> {faceDetected ? 'Blink to unlock' : 'Waiting for face...'}</>
                )}
              </button>

              <button type="button" onClick={stopCamera}
                className="btn-secondary text-sm px-3">
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-600 text-center">
        Blink once <strong className="text-gray-400">OR</strong> hold still for {FACE_HOLD_SECONDS}s to unlock capture
      </p>
    </div>
  )
}
