import axios from 'axios'

const api = axios.create({
  baseURL: `${import.meta.env.VITE_API_BASE_URL || ''}/api/v1`,
  headers: { 'Content-Type': 'application/json' },
})

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Auto-logout on 401 (but NOT for face verification failures — those return 401 too)
api.interceptors.response.use(
  (r) => r,
  (err) => {
    const url: string = err.config?.url || ''
    const is401 = err.response?.status === 401
    // Only auto-logout on auth endpoints, not face verification failures
    const isFaceOrSign = url.includes('/transactions/sign') || url.includes('/face/')
    if (is401 && !isFaceOrSign) {
      localStorage.clear()
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api

// ── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  register: (data: { username: string; email: string; password: string }) =>
    api.post('/auth/register', data),

  login: (username: string, password: string) => {
    const form = new URLSearchParams()
    form.append('username', username)
    form.append('password', password)
    return api.post('/auth/login', form, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
  },

  // Google OAuth — send Google credential token to backend
  googleLogin: (credential: string) =>
    api.post('/auth/google', { credential }),

  me: () => api.get('/auth/me'),

  loginWithFace: (username: string, password: string, faceBlob: Blob) => {
    const form = new FormData()
    form.append('username', username)
    form.append('password', password)
    form.append('face_image', faceBlob, 'face.jpg')
    return api.post('/auth/login-with-face', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
}

// ── Keys ──────────────────────────────────────────────────────────────────────
export const keysApi = {
  generate: () => api.post('/keys/generate'),
  list: () => api.get('/keys/my-keys'),
  revoke: (keyId: string) => api.delete(`/keys/${keyId}`),
}

// ── Transactions ──────────────────────────────────────────────────────────────
export const txApi = {
  /**
   * Sign a transaction with face verification (multipart/form-data).
   * faceBlob is required when FACE_REQUIRED_FOR_SIGNING=true on backend.
   */
  sign: (params: {
    receiver_id:     string
    amount:          number
    currency:        string
    nonce:           string
    timestamp:       string
    private_key_pem: string
    key_id:          string
    face_blob:       Blob | null
  }) => {
    const form = new FormData()
    form.append('receiver_id',     params.receiver_id)
    form.append('amount',          String(params.amount))
    form.append('currency',        params.currency)
    form.append('nonce',           params.nonce)
    form.append('timestamp',       params.timestamp)
    form.append('private_key_pem', params.private_key_pem)
    form.append('key_id',          params.key_id)
    if (params.face_blob) {
      form.append('face_image', params.face_blob, 'face.jpg')
    }
    return api.post('/transactions/sign', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  /** JSON-only sign (no face) — for testing / API clients */
  signJson: (payload: object) => api.post('/transactions/sign-json', payload),

  verify:        (txId: string)    => api.post(`/transactions/verify/${txId}`),
  verifyPayload: (payload: object) => api.post('/transactions/verify-payload', payload),
  list:          (limit = 50, offset = 0) =>
    api.get(`/transactions/?limit=${limit}&offset=${offset}`),
  received: (limit = 50, offset = 0) =>
    api.get(`/transactions/received?limit=${limit}&offset=${offset}`),
  balance: () => api.get('/transactions/balance'),
  get: (txId: string) => api.get(`/transactions/${txId}`),
}

// ── Face ──────────────────────────────────────────────────────────────────────
export const faceApi = {
  /** Enroll face — upload image file */
  enroll: (faceBlob: Blob) => {
    const form = new FormData()
    form.append('face_image', faceBlob, 'face.jpg')
    return api.post('/face/register', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  /** Verify face standalone */
  verify: (faceBlob: Blob) => {
    const form = new FormData()
    form.append('face_image', faceBlob, 'face.jpg')
    return api.post('/face/verify', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  status: () => api.get('/face/status'),

  /** Delete face — REQUIRES live face verification (sends face image) */
  remove: (faceBlob: Blob) => {
    const form = new FormData()
    form.append('face_image', faceBlob, 'face.jpg')
    return api.delete('/face/', {
      data: form,
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
}

// ── Audit ─────────────────────────────────────────────────────────────────────
export const auditApi = {
  list: (txId?: string, limit = 100) =>
    api.get('/audit/', { params: { transaction_id: txId, limit } }),
}

// ── Fraud ─────────────────────────────────────────────────────────────────────
export const fraudApi = {
  assess: (amount: number, currency = 'INR') =>
    api.post('/fraud/assess', { amount, currency }),
}
