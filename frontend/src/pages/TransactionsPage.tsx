import React, { useState, useEffect } from 'react'
import { List, RefreshCw, ArrowRight } from 'lucide-react'
import { txApi } from '../services/api'
import { format } from 'date-fns'
import { useNavigate } from 'react-router-dom'

interface Transaction {
  id: string
  receiver_id: string
  amount: number
  currency: string
  status: string
  payload_hash: string
  created_at: string
}

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    verified: 'badge-green',
    pending: 'badge-yellow',
    rejected: 'badge-red',
    tampered: 'badge-red',
  }
  return map[status] || 'badge-blue'
}

export default function TransactionsPage() {
  const [txs, setTxs] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await txApi.list()
      setTxs(data)
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
            <List className="text-blue-400" size={24} />
            Transactions
          </h1>
          <p className="text-gray-400 mt-1">All signed transactions for your account</p>
        </div>
        <button onClick={load} className="btn-secondary flex items-center gap-2">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900/50">
              <th className="text-left px-4 py-3 text-gray-400 font-medium">ID</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Receiver</th>
              <th className="text-right px-4 py-3 text-gray-400 font-medium">Amount</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Status</th>
              <th className="text-left px-4 py-3 text-gray-400 font-medium">Created</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-8 text-gray-500">Loading...</td></tr>
            ) : txs.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-gray-500">
                No transactions yet. <button onClick={() => navigate('/sign')}
                  className="text-blue-400 hover:underline">Sign your first transaction</button>
              </td></tr>
            ) : txs.map((tx) => (
              <tr key={tx.id} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                <td className="px-4 py-3">
                  <code className="text-xs text-gray-400">{tx.id.slice(0, 8)}...</code>
                </td>
                <td className="px-4 py-3 text-gray-300 max-w-[120px] truncate">{tx.receiver_id}</td>
                <td className="px-4 py-3 text-right font-mono font-medium text-white">
                  {tx.amount.toLocaleString()} {tx.currency}
                </td>
                <td className="px-4 py-3">
                  <span className={statusBadge(tx.status)}>{tx.status}</span>
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {format(new Date(tx.created_at), 'MMM d, HH:mm')}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => navigate(`/verify?id=${tx.id}`)}
                    className="text-gray-500 hover:text-blue-400 transition-colors"
                    title="Verify this transaction"
                  >
                    <ArrowRight size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
