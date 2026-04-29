import axios from 'axios'

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
})

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Auto-logout on 401
api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) {
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
}

// ── Keys ──────────────────────────────────────────────────────────────────────
export const keysApi = {
  generate: () => api.post('/keys/generate'),
  list: () => api.get('/keys/my-keys'),
  revoke: (keyId: string) => api.delete(`/keys/${keyId}`),
}

// ── Transactions ──────────────────────────────────────────────────────────────
export const txApi = {
  sign: (payload: object) => api.post('/transactions/sign', payload),
  verify: (txId: string) => api.post(`/transactions/verify/${txId}`),
  verifyPayload: (payload: object) => api.post('/transactions/verify-payload', payload),
  list: (limit = 50, offset = 0) => api.get(`/transactions/?limit=${limit}&offset=${offset}`),
  get: (txId: string) => api.get(`/transactions/${txId}`),
}

// ── Audit ─────────────────────────────────────────────────────────────────────
export const auditApi = {
  list: (txId?: string, limit = 100) =>
    api.get('/audit/', { params: { transaction_id: txId, limit } }),
}

// ── Fraud ─────────────────────────────────────────────────────────────────────
export const fraudApi = {
  assess: (amount: number, currency = 'USD') =>
    api.post('/fraud/assess', { amount, currency }),
}
