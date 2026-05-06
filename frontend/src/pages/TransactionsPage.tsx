/**
 * TransactionsPage.tsx
 * ====================
 * Full transaction dashboard with:
 *  - Balance summary cards (sent / received / net)
 *  - Sent tab — transactions you signed
 *  - Received tab — transactions sent TO you
 *  - Status badges, amount formatting, verify link
 */
import React, { useState, useEffect, useCallback } from 'react'
import {
  ArrowUpRight, ArrowDownLeft, RefreshCw,
  ArrowRight, TrendingUp, TrendingDown, Wallet,
  Send, Inbox,
} from 'lucide-react'
import { txApi } from '../services/api'
import { format } from 'date-fns'
import { useNavigate } from 'react-router-dom'

interface Transaction {
  id:              string
  sender_id:       string
  sender_username?: string
  receiver_id:     string
  amount:          number
  currency:        string
  status:          string
  payload_hash:    string
  created_at:      string
}

interface Balance {
  sent_count:  number
  sent_total:  number
  recv_count:  number
  recv_total:  number
  net_balance: number
}

type Tab = 'sent' | 'received'

// ── Helpers ───────────────────────────────────────────────────────────────────
const statusBadge = (s: string) => ({
  verified: 'badge-green',
  pending:  'badge-yellow',
  rejected: 'badge-red',
  tampered: 'badge-red',
}[s] || 'badge-blue')

const currencySymbol: Record<string, string> = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£', BTC: '₿', ETH: 'Ξ',
}

const fmt = (amount: number, currency: string) => {
  const sym = currencySymbol[currency] || ''
  return `${sym}${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${currency}`
}

// ── Balance card ──────────────────────────────────────────────────────────────
function BalanceCard({
  label, value, currency = 'INR', count, icon: Icon, color,
}: {
  label: string; value: number; currency?: string
  count: number; icon: React.ElementType; color: string
}) {
  return (
    <div className="card flex items-start gap-4">
      <div className={`p-2.5 rounded-xl ${color}`}>
        <Icon size={20} className="text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-400">{label}</p>
        <p className="text-xl font-bold text-white mt-0.5 truncate">
          {fmt(value, currency)}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">{count} transaction{count !== 1 ? 's' : ''}</p>
      </div>
    </div>
  )
}

// ── Transaction row ───────────────────────────────────────────────────────────
function TxRow({
  tx, type, onVerify,
}: {
  tx: Transaction; type: Tab; onVerify: (id: string) => void
}) {
  const isSent = type === 'sent'
  return (
    <tr className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
      {/* Direction icon */}
      <td className="px-4 py-3 w-8">
        {isSent
          ? <ArrowUpRight size={16} className="text-red-400" />
          : <ArrowDownLeft size={16} className="text-green-400" />}
      </td>

      {/* ID */}
      <td className="px-2 py-3">
        <div className="flex items-center gap-1.5">
          <code className="text-xs text-gray-300 font-mono">{tx.id}</code>
          <button
            onClick={() => { navigator.clipboard.writeText(tx.id); }}
            className="text-gray-600 hover:text-blue-400 transition-colors shrink-0"
            title="Copy full ID"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
            </svg>
          </button>
        </div>
      </td>

      {/* Counterparty */}
      <td className="px-2 py-3 max-w-[130px]">
        <p className="text-xs text-gray-500">{isSent ? 'To' : 'From'}</p>
        <p className="text-sm text-gray-200 truncate font-medium">
          {isSent
            ? tx.receiver_id
            : (tx.sender_username || tx.sender_id.slice(0, 8) + '...')}
        </p>
      </td>

      {/* Amount */}
      <td className="px-2 py-3 text-right">
        <span className={`font-mono font-semibold ${isSent ? 'text-red-300' : 'text-green-300'}`}>
          {isSent ? '−' : '+'}{fmt(tx.amount, tx.currency)}
        </span>
      </td>

      {/* Status */}
      <td className="px-2 py-3">
        <span className={statusBadge(tx.status)}>{tx.status}</span>
      </td>

      {/* Date */}
      <td className="px-2 py-3 text-gray-400 text-xs whitespace-nowrap">
        {format(new Date(tx.created_at), 'MMM d, HH:mm')}
      </td>

      {/* Action */}
      <td className="px-2 py-3">
        <button
          onClick={() => onVerify(tx.id)}
          className="text-gray-500 hover:text-blue-400 transition-colors"
          title="Verify transaction"
        >
          <ArrowRight size={15} />
        </button>
      </td>
    </tr>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function TransactionsPage() {
  const [tab, setTab]         = useState<Tab>('sent')
  const [sent, setSent]       = useState<Transaction[]>([])
  const [received, setReceived] = useState<Transaction[]>([])
  const [balance, setBalance] = useState<Balance | null>(null)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [sentRes, recvRes, balRes] = await Promise.all([
        txApi.list(),
        txApi.received(),
        txApi.balance(),
      ])
      setSent(sentRes.data)
      setReceived(recvRes.data)
      setBalance(balRes.data)
    } catch {
      // individual failures handled silently
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleVerify = (id: string) => navigate(`/verify?id=${id}`)

  const activeTxs = tab === 'sent' ? sent : received

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Wallet className="text-blue-400" size={24} />
            Transactions
          </h1>
          <p className="text-gray-400 mt-1">Your complete transaction history</p>
        </div>
        <button onClick={load} className="btn-secondary flex items-center gap-2">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* ── Balance cards ── */}
      {balance && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <BalanceCard
            label="Total Sent"
            value={balance.sent_total}
            count={balance.sent_count}
            icon={ArrowUpRight}
            color="bg-red-600"
          />
          <BalanceCard
            label="Total Received"
            value={balance.recv_total}
            count={balance.recv_count}
            icon={ArrowDownLeft}
            color="bg-green-600"
          />
          <BalanceCard
            label="Net Balance"
            value={Math.abs(balance.net_balance)}
            count={balance.sent_count + balance.recv_count}
            icon={balance.net_balance >= 0 ? TrendingUp : TrendingDown}
            color={balance.net_balance >= 0 ? 'bg-blue-600' : 'bg-orange-600'}
          />
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="card p-0 overflow-x-auto">
        {/* Tab bar */}
        <div className="flex border-b border-gray-800">
          <button
            onClick={() => setTab('sent')}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors ${
              tab === 'sent'
                ? 'text-white border-b-2 border-blue-500 bg-gray-800/40'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Send size={15} />
            Sent
            <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs bg-gray-700 text-gray-300">
              {sent.length}
            </span>
          </button>
          <button
            onClick={() => setTab('received')}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors ${
              tab === 'received'
                ? 'text-white border-b-2 border-green-500 bg-gray-800/40'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            <Inbox size={15} />
            Received
            {received.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs bg-green-700 text-green-200">
                {received.length}
              </span>
            )}
          </button>
        </div>

        {/* Table */}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900/30">
              <th className="px-4 py-2.5 w-8" />
              <th className="text-left px-2 py-2.5 text-gray-400 font-medium text-xs">ID</th>
              <th className="text-left px-2 py-2.5 text-gray-400 font-medium text-xs">
                {tab === 'sent' ? 'Recipient' : 'Sender'}
              </th>
              <th className="text-right px-2 py-2.5 text-gray-400 font-medium text-xs">Amount</th>
              <th className="text-left px-2 py-2.5 text-gray-400 font-medium text-xs">Status</th>
              <th className="text-left px-2 py-2.5 text-gray-400 font-medium text-xs">Date</th>
              <th className="px-2 py-2.5 w-8" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="text-center py-10 text-gray-500">
                  <RefreshCw size={20} className="animate-spin mx-auto mb-2" />
                  Loading...
                </td>
              </tr>
            ) : activeTxs.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-10 text-gray-500">
                  {tab === 'sent' ? (
                    <>
                      No sent transactions yet.{' '}
                      <button onClick={() => navigate('/sign')}
                        className="text-blue-400 hover:underline">
                        Sign your first transaction
                      </button>
                    </>
                  ) : (
                    'No received transactions yet. Share your username with senders.'
                  )}
                </td>
              </tr>
            ) : (
              activeTxs.map((tx) => (
                <TxRow key={tx.id} tx={tx} type={tab} onVerify={handleVerify} />
              ))
            )}
          </tbody>
        </table>

        {/* Received hint */}
        {tab === 'received' && (
          <div className="px-4 py-3 border-t border-gray-800 bg-gray-900/20">
            <p className="text-xs text-gray-500">
              💡 To receive transactions, share your <strong className="text-gray-300">username</strong> with the sender.
              They enter it as the Receiver ID when signing.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
