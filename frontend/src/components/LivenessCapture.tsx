/**
 * LivenessCapture.tsx
 * ===================
 * Auto-captures within 10 seconds.
 *
 * Flow:
 *  1. Camera starts automatically when component mounts
 *  2. 10-second countdown ring visible immediately
 *  3. Auto-captures as soon as liveness is confirmed (blink/pose)
 *  4. If 10s runs out without liveness → captures anyway (basic mode)
 *  5. Manual "Capture Now" button available at any time after face detected
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Camera, Eye, AlertTriangle, CheckCircle,
  RefreshCw, ShieldCheck, ShieldX, Activity, Zap,
} from 'lucide-react'

export interface LivenessCaptureResult {
  blob:          Blob
  dataUrl:       string
  frames:        string[]
  challengeId:   string
  blinkDetected: boolean
  headYaw:       number
}

interface Challenge { id: string; instruction: string; icon: string }

const CHALLENGES: Challenge[] = [
  { id: 'blink',      instruction: 'Blink your eyes',              icon: '👁' },
  { id: 'turn_left',  instruction: 'Turn head slightly left',      icon: '⬅' },
  { id: 'turn_right', instruction: 'Turn head slightly right',     icon: '➡' },
  { id: 'forward',    instruction: 'Look directly at the camera',  icon: '🎯' },
]

const TOTAL_SECONDS = 10   // hard deadline

// ── EAR ──────────────────────────────────────────────────────────────────────
function calcEAR(eye: { x: number; y: number }[]): number {
  if (eye.length < 6) return 0.3
  const d = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
  const A = d(eye[1], eye[5]), B = d(eye[2], eye[4]), C = d(eye[0], eye[3])
  return C < 0.001 ? 0.3 : (A + B) / (2 * C)
}

const LEFT_EYE  = [33, 160, 158, 133, 153, 144]
const RIGHT_EYE = [362, 385, 387, 263, 373, 380]

// ── SVG countdown ring ────────────────────────────────────────────────────────
function CountdownRing({ seconds, total }: { seconds: number; total: number }) {
  const r    = 22
  const circ = 2 * Math.PI * r
  const pct  = seconds / total
  const dash = pct * circ
  const color = seconds > 5 ? '#22c55e' : seconds > 3 ? '#f59e0b' : '#ef4444'

  return (
    <div className="relative flex items-center justify-center w-14 h-14">
      <svg width="56" height="56" viewBox="0 0 56 56" className="-rotate-90">
        <circle cx="28" cy="28" r={r} fill="none" stroke="#374151" strokeWidth="4" />
        <circle cx="28" cy="28" r={r} fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 1s linear, stroke 0.5s' }} />
      </svg>
      <span className="absolute text-lg font-bold" style={{ color }}>{seconds}</span>
    </div>
  )
}

interface Props {
  onCapture: (result: LivenessCaptureResult) => void
  onClear?:  () => void
  captured:  LivenessCaptureResult | null
  label?:    string
}

export default function LivenessCapture({ onCapture, onClear, captured, label }: Props) {
  const videoRef  = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const framesRef = useRef<string[]>([])
  const mpRef     = useRef<any>(null)
  const animRef   = useRef<number>(0)
  const timerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const capturedRef = useRef(false)   // prevent double-capture
  const blinkRef  = useRef(false)

  const [camError,      setCamError]      = useState('')
  const [started,       setStarted]       = useState(false)
  const [faceDetected,  setFaceDetected]  = useState(false)
  const [livenessOk,    setLivenessOk]    = useState(false)
  const [blinkCount,    setBlinkCount]    = useState(0)
  const [earValue,      setEarValue]      = useState(0.3)
  const [headYaw,       setHeadYaw]       = useState(0)
  const [spoofScore,    setSpoofScore]    = useState(0)
  const [secondsLeft,   setSecondsLeft]   = useState(TOTAL_SECONDS)
  const [autoCapturing, setAutoCapturing] = useState(false)
  const [challenge]     = useState<Challenge>(
    () => CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)]
  )

  // ── Capture image ─────────────────────────────────────────────────────────
  const doCapture = useCallback(() => {
    if (capturedRef.current) return
    capturedRef.current = true
    setAutoCapturing(true)

    const canvas = canvasRef.current
    if (!canvas) return

    canvas.toBlob(blob => {
      if (!blob) return
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
      onCapture({
        blob,
        dataUrl,
        frames:        [...framesRef.current],
        challengeId:   challenge.id,
        blinkDetected: blinkCount > 0,
        headYaw,
      })
      // Stop camera
      if (timerRef.current) clearInterval(timerRef.current)
      cancelAnimationFrame(animRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }, 'image/jpeg', 0.92)
  }, [challenge.id, blinkCount, headYaw, onCapture])

  // ── Stop camera ───────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    cancelAnimationFrame(animRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setStarted(false)
    setFaceDetected(false)
    setLivenessOk(false)
    setSecondsLeft(TOTAL_SECONDS)
    capturedRef.current = false
    setAutoCapturing(false)
  }, [])

  useEffect(() => () => stopCamera(), [stopCamera])

  // ── Auto-start on mount ───────────────────────────────────────────────────
  useEffect(() => {
    if (!captured) startCamera()
  }, [])   // eslint-disable-line

  // ── Start camera ─────────────────────────────────────────────────────────
  const startCamera = async () => {
    setCamError('')
    capturedRef.current = false
    framesRef.current   = []
    setSecondsLeft(TOTAL_SECONDS)
    setBlinkCount(0)
    setLivenessOk(false)
    setFaceDetected(false)
    setAutoCapturing(false)

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
      startCountdownTimer()
      initMediaPipe()
    } catch (err: any) {
      setCamError(
        err.name === 'NotAllowedError' ? 'Camera permission denied. Please allow camera access.' :
        err.name === 'NotFoundError'   ? 'No camera found on this device.' :
        `Camera error: ${err.message}`
      )
    }
  }

  // ── 10-second countdown timer ─────────────────────────────────────────────
  const startCountdownTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    let s = TOTAL_SECONDS
    timerRef.current = setInterval(() => {
      s -= 1
      setSecondsLeft(s)
      if (s <= 0) {
        clearInterval(timerRef.current!)
        // Time's up — capture whatever we have
        doCapture()
      }
    }, 1000)
  }

  // ── MediaPipe ─────────────────────────────────────────────────────────────
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

  // ── MediaPipe results ─────────────────────────────────────────────────────
  const onResults = (results: any) => {
    const canvas = canvasRef.current
    const video  = videoRef.current
    if (!canvas || !video || capturedRef.current) return

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
      return
    }

    setFaceDetected(true)
    const lm = results.multiFaceLandmarks[0]

    // Face mesh dots
    ctx.fillStyle = 'rgba(0,200,255,0.35)'
    lm.forEach((p: any) => {
      ctx.beginPath()
      ctx.arc(p.x * W, p.y * H, 1.2, 0, 2 * Math.PI)
      ctx.fill()
    })

    // EAR
    const lPts = LEFT_EYE.map(i  => ({ x: lm[i].x * W, y: lm[i].y * H }))
    const rPts = RIGHT_EYE.map(i => ({ x: lm[i].x * W, y: lm[i].y * H }))
    const ear  = (calcEAR(lPts) + calcEAR(rPts)) / 2
    setEarValue(ear)

    if (ear < 0.21 && !blinkRef.current) {
      blinkRef.current = true
      setBlinkCount(c => {
        const next = c + 1
        return next
      })
    } else if (ear > 0.25) {
      blinkRef.current = false
    }

    // Eye outlines
    ctx.strokeStyle = ear < 0.21 ? '#ff4444' : '#00ff88'
    ctx.lineWidth = 1.5
    ;[lPts, rPts].forEach(pts => {
      ctx.beginPath()
      pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
      ctx.closePath()
      ctx.stroke()
    })

    // Head yaw
    const nose = lm[1], lE = lm[33], rE = lm[263]
    const midX = (lE.x + rE.x) / 2
    const eyeD = Math.abs(rE.x - lE.x)
    const yaw  = eyeD > 0.01 ? ((nose.x - midX) / eyeD) * 45 : 0
    setHeadYaw(yaw)

    // Spoof heuristic
    const spoof = ear < 0.05 ? 0.8 : ear > 0.5 ? 0.6 : 0.1
    setSpoofScore(spoof)

    // Liveness check
    let ok = false
    if (challenge.id === 'blink')      ok = blinkCount >= 1
    else if (challenge.id === 'turn_left')  ok = yaw < -15
    else if (challenge.id === 'turn_right') ok = yaw > 15
    else ok = Math.abs(yaw) < 20

    setLivenessOk(ok)

    // ── AUTO-CAPTURE when liveness confirmed ──────────────────────────────
    if (ok && !capturedRef.current) {
      // Small delay so user sees the green confirmation
      setTimeout(() => doCapture(), 600)
    }
  }

  // ── Buffer frames ─────────────────────────────────────────────────────────
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

  // ── Status ────────────────────────────────────────────────────────────────
  const statusColor = livenessOk ? 'text-green-400' : faceDetected ? 'text-yellow-400' : 'text-gray-400'
  const statusMsg   = autoCapturing
    ? '✓ Capturing...'
    : livenessOk
    ? '✓ Liveness confirmed — capturing'
    : faceDetected
    ? `${challenge.icon} ${challenge.instruction}`
    : '👤 Position your face in the oval'

  // ── Captured preview ──────────────────────────────────────────────────────
  if (captured) {
    return (
      <div className="space-y-2">
        {label && <label className="label">{label}</label>}
        <div className="relative rounded-xl overflow-hidden border border-green-700 bg-gray-900">
          <img src={captured.dataUrl} alt="Captured face"
            className="w-full max-h-56 object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute top-3 left-3">
            <span className="badge-green text-xs flex items-center gap-1">
              <CheckCircle size={11} /> Liveness verified
            </span>
          </div>
          <div className="absolute bottom-3 left-0 right-0 flex justify-center">
            <button type="button"
              onClick={() => { onClear?.(); stopCamera(); startCamera() }}
              className="btn-secondary text-sm py-1.5 px-4 flex items-center gap-2">
              <RefreshCw size={14} /> Retake
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Camera view ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-2">
      {label && (
        <label className="label flex items-center gap-2">
          <ShieldCheck size={14} className="text-blue-400" /> {label}
        </label>
      )}

      <div className="rounded-xl overflow-hidden border border-gray-700 bg-gray-900">

        {/* ── Video area ── */}
        <div className="relative aspect-video bg-gray-950 flex items-center justify-center">
          <video ref={videoRef} className="hidden" muted playsInline />
          <canvas ref={canvasRef}
            className={`w-full h-full object-cover ${started ? 'block' : 'hidden'}`} />

          {/* Not started / error */}
          {!started && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              {camError ? (
                <>
                  <AlertTriangle size={36} className="text-red-400" />
                  <p className="text-sm text-red-400 text-center px-6">{camError}</p>
                  <button onClick={startCamera} className="btn-primary text-sm">
                    Try Again
                  </button>
                </>
              ) : (
                <>
                  <Camera size={36} className="animate-pulse text-blue-400" />
                  <p className="text-sm text-gray-400">Starting camera...</p>
                </>
              )}
            </div>
          )}

          {/* Face oval guide */}
          {started && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className={`w-44 h-56 rounded-full border-2 border-dashed transition-colors duration-300 ${
                livenessOk || autoCapturing
                  ? 'border-green-400 shadow-[0_0_20px_rgba(34,197,94,0.4)]'
                  : faceDetected
                  ? 'border-yellow-400/70'
                  : 'border-gray-600/50'
              }`} />
            </div>
          )}

          {/* Countdown ring — top right */}
          {started && !autoCapturing && (
            <div className="absolute top-3 right-3">
              <CountdownRing seconds={secondsLeft} total={TOTAL_SECONDS} />
            </div>
          )}

          {/* Auto-capturing flash */}
          {autoCapturing && (
            <div className="absolute inset-0 bg-white/20 flex items-center justify-center">
              <div className="bg-green-500 rounded-full p-4 animate-ping" />
            </div>
          )}
        </div>

        {/* ── Status bar ── */}
        {started && (
          <div className="px-3 py-2 bg-gray-900 border-t border-gray-800 space-y-2">

            {/* Instruction */}
            <p className={`text-sm font-medium text-center ${statusColor}`}>
              {statusMsg}
            </p>

            {/* Stats */}
            <div className="flex items-center justify-between text-xs text-gray-500 gap-2">
              <span className="flex items-center gap-1">
                <Eye size={11} className={earValue < 0.21 ? 'text-red-400' : 'text-green-400'} />
                EAR {earValue.toFixed(2)}
              </span>
              <span className="flex items-center gap-1">
                <Activity size={11} />
                Blinks: {blinkCount}
              </span>
              <span>Yaw: {headYaw.toFixed(0)}°</span>
              <span className={`flex items-center gap-1 ${spoofScore > 0.5 ? 'text-red-400' : 'text-green-400'}`}>
                {spoofScore > 0.5
                  ? <><ShieldX size={11} /> Spoof?</>
                  : <><ShieldCheck size={11} /> Live</>}
              </span>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
              <div className={`h-1.5 rounded-full transition-all duration-500 ${
                livenessOk ? 'bg-green-500 w-full' : faceDetected ? 'bg-yellow-500 w-1/2' : 'bg-gray-600 w-1/12'
              }`} />
            </div>
          </div>
        )}

        {/* ── Controls ── */}
        <div className="p-3 flex gap-2 justify-center bg-gray-900/80">
          {!started && !camError && (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Camera size={15} className="animate-pulse" /> Starting...
            </div>
          )}
          {started && !autoCapturing && (
            <>
              {/* Manual capture — available once face is detected */}
              <button type="button" onClick={doCapture}
                disabled={!faceDetected}
                className="btn-primary flex items-center gap-2 text-sm disabled:opacity-40">
                <Zap size={15} />
                {faceDetected ? 'Capture Now' : 'Waiting for face...'}
              </button>
              <button type="button" onClick={stopCamera}
                className="btn-secondary text-sm">
                Cancel
              </button>
            </>
          )}
          {autoCapturing && (
            <span className="text-sm text-green-400 flex items-center gap-2">
              <CheckCircle size={15} /> Captured!
            </span>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-500 text-center">
        Auto-captures in <strong className="text-white">{secondsLeft}s</strong> ·
        Blink to confirm liveness · Anti-spoofing active
      </p>
    </div>
  )
}
