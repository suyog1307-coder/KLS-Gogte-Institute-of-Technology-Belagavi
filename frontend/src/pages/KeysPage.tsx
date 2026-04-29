import React, { useState, useEffect } from 'react'
import { KeyRound, Plus, Copy, Eye, EyeOff, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { keysApi } from '../services/api'
import { format } from 'date-fns'

interface KeyPair {
  key_id: string
  public_key_pem: string
  algorithm: string
  created_at: string
  private_key_pem?: string
}

export default function KeysPage() {
  const [keys, setKeys] = useState<KeyPair[]>([])
  const [newKey, setNewKey] = useState<KeyPair | null>(null)
  const [showPrivate, setShowPrivate] = useState(false)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    fetchKeys()
  }, [])

  const fetchKeys = async () => {
    setLoading(true)
    try {
      const { data } = await keysApi.list()
      setKeys(data)
    } catch {
      toast.error('Failed to load keys')
    } finally {
      setLoading(false)
    }
  }

  const generateKey = async () => {
    setGenerating(true)
    try {
      const { data } = await keysApi.generate()
      setNewKey(data)
      toast.success('Key pair generated! Save your private key now.')
      fetchKeys()
    } catch {
      toast.error('Key generation failed')
    } finally {
      setGenerating(false)
    }
  }

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    toast.success(`${label} copied to clipboard`)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <KeyRound className="text-blue-400" size={24} />
            Key Management
          </h1>
          <p className="text-gray-400 mt-1">ECDSA P-256 key pairs for transaction signing</p>
        </div>
        <button onClick={generateKey} disabled={generating} className="btn-primary flex items-center gap-2">
          <Plus size={18} />
          {generating ? 'Generating...' : 'Generate Key Pair'}
        </button>
      </div>

      {/* New key alert — shown once */}
      {newKey && (
        <div className="card border-yellow-700 bg-yellow-900/10">
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle className="text-yellow-400 mt-0.5 shrink-0" size={20} />
            <div>
              <h3 className="font-semibold text-yellow-300">Save Your Private Key Now</h3>
              <p className="text-sm text-yellow-400/80 mt-1">
                This is the ONLY time your private key will be shown. It is never stored on the server.
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="label">Key ID</span>
                <button onClick={() => copyToClipboard(newKey.key_id, 'Key ID')}
                  className="text-xs text-blue-400 hover:underline flex items-center gap-1">
                  <Copy size={12} /> Copy
                </button>
              </div>
              <code className="block bg-gray-800 rounded p-2 text-xs text-gray-300 break-all">
                {newKey.key_id}
              </code>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="label">Private Key (PEM)</span>
                <div className="flex gap-2">
                  <button onClick={() => setShowPrivate(!showPrivate)}
                    className="text-xs text-gray-400 hover:text-white flex items-center gap-1">
                    {showPrivate ? <EyeOff size={12} /> : <Eye size={12} />}
                    {showPrivate ? 'Hide' : 'Show'}
                  </button>
                  <button onClick={() => copyToClipboard(newKey.private_key_pem!, 'Private key')}
                    className="text-xs text-blue-400 hover:underline flex items-center gap-1">
                    <Copy size={12} /> Copy
                  </button>
                </div>
              </div>
              {showPrivate ? (
                <pre className="bg-gray-800 rounded p-3 text-xs text-green-400 overflow-x-auto whitespace-pre-wrap break-all">
                  {newKey.private_key_pem}
                </pre>
              ) : (
                <div className="bg-gray-800 rounded p-3 text-xs text-gray-500 text-center">
                  Click "Show" to reveal private key
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="label">Public Key (PEM)</span>
                <button onClick={() => copyToClipboard(newKey.public_key_pem, 'Public key')}
                  className="text-xs text-blue-400 hover:underline flex items-center gap-1">
                  <Copy size={12} /> Copy
                </button>
              </div>
              <pre className="bg-gray-800 rounded p-3 text-xs text-blue-300 overflow-x-auto whitespace-pre-wrap break-all">
                {newKey.public_key_pem}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Existing keys */}
      <div className="card">
        <h2 className="font-semibold text-white mb-4">Your Key Pairs</h2>
        {loading ? (
          <p className="text-gray-500 text-sm">Loading...</p>
        ) : keys.length === 0 ? (
          <p className="text-gray-500 text-sm">No keys yet. Generate your first key pair above.</p>
        ) : (
          <div className="space-y-3">
            {keys.map((k) => (
              <div key={k.key_id} className="bg-gray-800 rounded-lg p-4 flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="badge-blue">{k.algorithm}</span>
                    <span className="text-xs text-gray-500">
                      {format(new Date(k.created_at), 'MMM d, yyyy HH:mm')}
                    </span>
                  </div>
                  <code className="text-xs text-gray-400 break-all">{k.key_id}</code>
                </div>
                <button
                  onClick={() => copyToClipboard(k.key_id, 'Key ID')}
                  className="text-gray-500 hover:text-blue-400 transition-colors shrink-0"
                  title="Copy Key ID"
                >
                  <Copy size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
