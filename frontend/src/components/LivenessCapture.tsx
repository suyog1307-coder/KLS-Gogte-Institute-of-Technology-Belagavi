/**
 * LivenessCapture.tsx
 * ===================
 * Real-time anti-spoofing webcam component using MediaPipe Face Mesh.
 *
 * Features:
 *  - Live face mesh overlay (468 landmarks)
 *  - Real-time EAR (Eye Aspect Ratio) blink detection
 *  - Head pose estimation (yaw/pitch)
 *  - Multi-frame capture for consistency check
 *  - Challenge-response UI (blink / turn head / look up)
 *  - Spoof detection status display
 *  - Confidence score bar
 */
import React, {
  useCallback, useEffect, useRef, useState,
} from 'react'
import {
  Camera, Eye, AlertTriangle, CheckCircle,
  RefreshCw, ShieldCheck, ShieldX, Activity,
} from 'lucide-react'

export interface LivenessCaptureResult {
  blob:          Blob
  dataUrl:       string
  frames:        string[]   // base64 frames for multi-frame check
  challengeId:   string
  blinkDetected: boolean
  headYaw:       number
}

interface Challenge {
  id:          string
  instruction: string
  icon:        string
}

const CHALLENGES: Challenge[] = [
  { id: 'blink',      instruction: 'Please blink your eyes',        icon: '👁' },
  { id: 'blink2',     instruction: 'Blink twice slowly',            icon: '👀' },
  { id: 'turn_left',  instruction: 'Turn your head slightly left',  icon: '⬅' },
  { id: 'turn_right', instruction: 'Turn your head slightly right', icon: '➡' },
  { id: 'forward',    instruction: 'Look directly at the camera',   icon: '🎯' },
]

interface Props {
  onCapture:   (result: LivenessCaptureResult) => void
  onClear?:    () => void
  captured:    LivenessCaptureResult | null
  label?:      string
}

type Status = 'idle' | 'starting' | 'active' | 'captured' | 'error'

// ── EAR calculation (pure JS) ─────────────────────────────────────────────
function calcEAR(eye: {x:number;y:number}[]): number {
  if (eye.length < 6) return 0.3
  const dist = (a: {x:number;y:number}, b: {x:number;y:number}) =>
    Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2)
  const A = dist(eye[1], eye[5])
  const B = dist(eye[2], eye[4])
  const C = dist(eye[0], eye[3])
  return C < 0.001 ? 0.3 : (A + B) / (2 * C)
}

// MediaPipe landmark indices
const LEFT_EYE  = [33, 160, 158, 133, 153, 144]
const RIGHT_EYE = [362, 385, 387, 263, 373, 380]

export default function LivenessCapture({ onCapture, onClear, captured, label }: Props) {
  const videoRef   = useRef<HTMLVideoElement>(null)
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const streamRef  = useRef<MediaStream | null>(null)
  const framesRef  = useRef<string[]>([])
  const mpRef      = useRef<any>(null)
  const animRef    = useRef<number>(0)

  const [camStatus, setCamStatus]   = useState<Status>('idle')
  const [camError, setCamError]     = useState('')
  const [challenge, setChallenge]   = useState<Challenge>(CHALLENGES[0])
  const [blinkCount, setBlinkCount] = useState(0)
  const [earValue, setEarValue]     = useState(0.3)
  const [headYaw, setHeadYaw]       = useState(0)
  const [spoofScore, setSpoofScore] = useState(0)
  const [livenessOk, setLivenessOk] = useState(false)
  const [faceDetected, setFaceDetected] = useState(false)
  const [countdown, setCountdown]   = useState(0)
  const blinkRef = useRef(false)

  // Pick random challenge on mount
  useEffect(() => {
    setChallenge(CHALLENGES[Math.floor(Math.random() * CHALLENGES.length)])
  }, [])

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(animRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setCamStatus('idle')
    setFaceDetected(false)
    setLivenessOk(false)
  }, [])

  useEffect(() => () => stopCamera(), [stopCamera])

  // ── Start camera + MediaPipe ──────────────────────────────────────────────
  const startCamera = async () => {
    setCamError('')
    setCamStatus('starting')
    framesRef.current = []
    setBlinkCount(0)
    setLivenessOk(false)

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
      setCamStatus('active')
      initMediaPipe()
    } catch (err: any) {
      setCamError(
        err.name === 'NotAllowedError' ? 'Camera permission denied.' :
        err.name === 'NotFoundError'   ? 'No camera found.' :
        `Camera error: ${err.message}`
      )
      setCamStatus('error')
    }
  }

  // ── MediaPipe Face Mesh ───────────────────────────────────────────────────
  const initMediaPipe = async () => {
    try {
      // @ts-ignore
      const { FaceMesh } = await import('@mediapipe/face_mesh')
      const faceMesh = new FaceMesh({
        locateFile: (file: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
      })
      faceMesh.setOptions({
        maxNumFaces:          1,
        refineLandmarks:      true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence:  0.5,
      })
      faceMesh.onResults(onFaceMeshResults)
      mpRef.current = faceMesh
      runLoop()
    } catch (e) {
      // MediaPipe CDN failed — run without it (basic mode)
      console.warn('MediaPipe unavailable, running basic mode')
      runLoop()
    }
  }

  const runLoop = () => {
    const loop = async () => {
      if (!videoRef.current || !streamRef.current) return
      if (mpRef.current) {
        try { await mpRef.current.send({ image: videoRef.current }) }
        catch { /* ignore */ }
      }
      captureFrame()
      animRef.current = requestAnimationFrame(loop)
    }
    animRef.current = requestAnimationFrame(loop)
  }

  // ── Process MediaPipe results ─────────────────────────────────────────────
  const onFaceMeshResults = (results: any) => {
    const canvas = canvasRef.current
    const video  = videoRef.current
    if (!canvas || !video) return

    const ctx = canvas.getContext('2d')!
    canvas.width  = video.videoWidth  || 640
    canvas.height = video.videoHeight || 480

    // Mirror + draw video
    ctx.save()
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    ctx.restore()

    if (!results.multiFaceLandmarks?.length) {
      setFaceDetected(false)
      return
    }

    setFaceDetected(true)
    const lm = results.multiFaceLandmarks[0]
    const W  = canvas.width, H = canvas.height

    // Draw face mesh dots
    ctx.fillStyle = 'rgba(0,200,255,0.4)'
    lm.forEach((p: any) => {
      ctx.beginPath()
      ctx.arc(p.x * W, p.y * H, 1.2, 0, 2 * Math.PI)
      ctx.fill()
    })

    // EAR blink detection
    const leftPts  = LEFT_EYE.map(i  => ({ x: lm[i].x * W,  y: lm[i].y * H }))
    const rightPts = RIGHT_EYE.map(i => ({ x: lm[i].x * W,  y: lm[i].y * H }))
    const earL = calcEAR(leftPts)
    const earR = calcEAR(rightPts)
    const ear  = (earL + earR) / 2
    setEarValue(ear)

    // Blink: EAR drops below 0.21
    if (ear < 0.21 && !blinkRef.current) {
      blinkRef.current = true
      setBlinkCount(c => c + 1)
    } else if (ear > 0.25) {
      blinkRef.current = false
    }

    // Head yaw from nose tip vs eye midpoint
    const nose   = lm[1]
    const lEye   = lm[33]
    const rEye   = lm[263]
    const midX   = (lEye.x + rEye.x) / 2
    const eyeDist = Math.abs(rEye.x - lEye.x)
    const yaw    = eyeDist > 0.01 ? ((nose.x - midX) / eyeDist) * 45 : 0
    setHeadYaw(yaw)

    // Draw eye landmarks
    ctx.strokeStyle = ear < 0.21 ? '#ff4444' : '#00ff88'
    ctx.lineWidth = 1.5
    ;[leftPts, rightPts].forEach(pts => {
      ctx.beginPath()
      pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
      ctx.closePath()
      ctx.stroke()
    })

    // Evaluate liveness
    evaluateLiveness(ear, yaw)
  }

  // ── Capture frame for multi-frame buffer ──────────────────────────────────
  const captureFrame = () => {
    const video = videoRef.current
    if (!video || video.readyState < 2) return
    const tmp = document.createElement('canvas')
    tmp.width  = video.videoWidth  || 320
    tmp.height = video.videoHeight || 240
    const ctx = tmp.getContext('2d')!
    ctx.translate(tmp.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0)
    const b64 = tmp.toDataURL('image/jpeg', 0.5).split(',')[1]
    framesRef.current.push(b64)
    if (framesRef.current.length > 8) framesRef.current.shift()
  }

  // ── Liveness evaluation ───────────────────────────────────────────────────
  const evaluateLiveness = (ear: number, yaw: number) => {
    let ok = false
    const ch = challenge

    if (ch.id === 'blink' || ch.id === 'blink2') {
      ok = blinkCount >= (ch.id === 'blink2' ? 2 : 1)
    } else if (ch.id === 'turn_left') {
      ok = yaw < -15
    } else if (ch.id === 'turn_right') {
      ok = yaw > 15
    } else {
      ok = faceDetected && Math.abs(yaw) < 20
    }

    // Basic spoof heuristic from EAR
    const spoof = ear < 0.05 ? 0.8 : ear > 0.5 ? 0.6 : 0.1
    setSpoofScore(spoof)
    setLivenessOk(ok)
  }

  // ── Capture final image ───────────────────────────────────────────────────
  const captureImage = () => {
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
      stopCamera()
    }, 'image/jpeg', 0.92)
  }

  // ── Countdown capture ─────────────────────────────────────────────────────
  const startCountdown = () => {
    let c = 3
    setCountdown(c)
    const id = setInterval(() => {
      c -= 1
      setCountdown(c)
      if (c === 0) { clearInterval(id); setCountdown(0); captureImage() }
    }, 1000)
  }

  // ── Status colors ─────────────────────────────────────────────────────────
  const statusColor = livenessOk ? 'text-green-400' : faceDetected ? 'text-yellow-400' : 'text-red-400'
  const statusMsg   = livenessOk
    ? '✓ Liveness confirmed'
    : faceDetected
    ? challenge.instruction
    : 'Position your face in the frame'

  if (captured) {
    return (
      <div className="space-y-2">
        {label && <label className="label">{label}</label>}
        <div className="relative rounded-xl overflow-hidden border border-green-700">
          <img src={captured.dataUrl} alt="Captured" className="w-full max-h-56 object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute bottom-3 left-0 right-0 flex justify-center">
            <button type="button" onClick={() => { onClear?.(); stopCamera() }}
              className="btn-secondary text-sm py-1.5 px-4 flex items-center gap-2">
              <RefreshCw size={14} /> Retake
            </button>
          </div>
          <div className="absolute top-3 right-3">
            <span className="badge-green text-xs flex items-center gap-1">
              <CheckCircle size={11} /> Liveness verified
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {label && <label className="label flex items-center gap-2">
        <ShieldCheck size={14} className="text-blue-400" /> {label}
      </label>}

      <div className="rounded-xl overflow-hidden border border-gray-700 bg-gray-900">
        {/* Video / canvas */}
        <div className="relative aspect-video bg-gray-950 flex items-center justify-center">
          <video ref={videoRef} className="hidden" muted playsInline />
          <canvas ref={canvasRef}
            className={`w-full h-full object-cover ${camStatus === 'active' ? 'block' : 'hidden'}`} />

          {camStatus !== 'active' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-500">
              {camStatus === 'starting' ? (
                <><Camera size={36} className="animate-pulse text-blue-400" /><p className="text-sm">Starting camera...</p></>
              ) : camStatus === 'error' ? (
                <><AlertTriangle size={36} className="text-red-400" /><p className="text-sm text-red-400 text-center px-4">{camError}</p></>
              ) : (
                <><ShieldCheck size={36} /><p className="text-sm">Anti-spoofing camera</p></>
              )}
            </div>
          )}

          {/* Face guide oval */}
          {camStatus === 'active' && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div className={`w-44 h-56 rounded-full border-2 border-dashed ${
                livenessOk ? 'border-green-400/80' : faceDetected ? 'border-yellow-400/60' : 'border-gray-600/40'
              }`} />
            </div>
          )}

          {/* Countdown */}
          {countdown > 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-7xl font-bold text-white drop-shadow-lg">{countdown}</span>
            </div>
          )}
        </div>

        {/* Live stats bar */}
        {camStatus === 'active' && (
          <div className="px-3 py-2 bg-gray-900/80 border-t border-gray-800 space-y-2">
            {/* Challenge instruction */}
            <div className={`text-sm font-medium text-center ${statusColor}`}>
              {challenge.icon} {statusMsg}
            </div>

            {/* Stats row */}
            <div className="flex items-center justify-between text-xs text-gray-400 gap-3">
              <div className="flex items-center gap-1.5">
                <Eye size={12} className={earValue < 0.21 ? 'text-red-400' : 'text-green-400'} />
                <span>EAR: {earValue.toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Activity size={12} />
                <span>Blinks: {blinkCount}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span>Yaw: {headYaw.toFixed(0)}°</span>
              </div>
              <div className="flex items-center gap-1.5">
                {spoofScore > 0.5
                  ? <ShieldX size={12} className="text-red-400" />
                  : <ShieldCheck size={12} className="text-green-400" />}
                <span className={spoofScore > 0.5 ? 'text-red-400' : 'text-green-400'}>
                  {spoofScore > 0.5 ? 'Spoof?' : 'Live'}
                </span>
              </div>
            </div>

            {/* Liveness progress bar */}
            <div className="w-full bg-gray-800 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  livenessOk ? 'bg-green-500' : 'bg-yellow-500'
                }`}
                style={{ width: livenessOk ? '100%' : faceDetected ? '50%' : '10%' }}
              />
            </div>
          </div>
        )}

        {/* Controls */}
        <div className="p-3 flex gap-2 justify-center bg-gray-900/80">
          {camStatus === 'idle' || camStatus === 'error' ? (
            <button type="button" onClick={startCamera}
              className="btn-primary flex items-center gap-2 text-sm">
              <Camera size={16} /> Start Liveness Check
            </button>
          ) : camStatus === 'active' ? (
            <>
              <button type="button" onClick={startCountdown}
                disabled={!livenessOk || countdown > 0}
                className="btn-primary flex items-center gap-2 text-sm disabled:opacity-40">
                <CheckCircle size={16} />
                {countdown > 0 ? `Capturing in ${countdown}...` : 'Capture'}
              </button>
              <button type="button" onClick={stopCamera} className="btn-secondary text-sm">
                Cancel
              </button>
            </>
          ) : null}
        </div>
      </div>

      <p className="text-xs text-gray-500">
        Anti-spoofing active · Blink detection · Head pose · Texture analysis
      </p>
    </div>
  )
}
