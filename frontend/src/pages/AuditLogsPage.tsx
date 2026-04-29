import React, { useState, useEffect } from 'react'
import { ScrollText, RefreshCw, CheckCircle, XCircle } from 'lucide-react'
import { auditApi } from '../services/api'
import { format } from 'date-fns'

interface AuditLog {
  id: string
  event_type: string
  actor_id: string
  transaction_id: string | null
  detail: string | null
  ip_address: string | null
  success: boolean
  created_at: string
}

const eventColor = (type: string) => {
  if (type.includes('FAIL') || type.includes('REJECT') || type.includes('TAMPER')) return 'text-red-400'
  if (type.includes('SIGN') || type.includes('VERIFY')) return 'text-blue-400'
  if (type.includes('KEY')) return 'text-yellow-400'
  if (type.includes('USER') || type.includes('LOGIN')) return 'text-green-400'
  return 'text-gray-400'
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await auditApi.list()
      setLogs(data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <ScrollText className="text-blue-400" size={24} />
            Audit Logs
          </h1>
          <p className="text-gray-400 mt-1">Append-only immutable event log</p>
        </div>
        <button onClick={load} className="btn-secondary flex items-center gap-2">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 bg-gray-900/50 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs text-gray-400">Live — {logs.length} events recorded</span>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        ) : logs.length === 0 ? (
          <div className="text-center py-8 text-gray-500">No audit events yet</div>
        ) : (
          <div className="divide-y divide-gray-800/50">
            {logs.map((log) => (
              <div key={log.id} className="px-4 py-3 hover:bg-gray-800/20 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    {log.success ? (
                      <CheckCircle size={16} className="text-green-500 mt-0.5 shrink-0" />
                    ) : (
                      <XCircle size={16} className="text-red-500 mt-0.5 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-mono text-sm font-medium ${eventColor(log.event_type)}`}>
                          {log.event_type}
                        </span>
                        {log.transaction_id && (
                          <code className="text-xs text-gray-500">
                            tx:{log.transaction_id.slice(0, 8)}
                          </code>
                        )}
                        {log.ip_address && (
                          <span className="text-xs text-gray-600">{log.ip_address}</span>
                        )}
                      </div>
                      {log.detail && (
                        <button
                          onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                          className="text-xs text-gray-500 hover:text-gray-300 mt-1"
                        >
                          {expanded === log.id ? 'Hide details' : 'Show details'}
                        </button>
                      )}
                      {expanded === log.id && log.detail && (
                        <pre className="mt-2 text-xs bg-gray-800 rounded p-2 text-gray-300 overflow-x-auto">
                          {JSON.stringify(JSON.parse(log.detail), null, 2)}
                        </pre>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-gray-500 shrink-0">
                    {format(new Date(log.created_at), 'MMM d, HH:mm:ss')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
