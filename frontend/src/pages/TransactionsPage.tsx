import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  ArrowUpRight, ArrowDownLeft, RefreshCw, ArrowRight,
  TrendingUp, TrendingDown, Send, Inbox, ShieldCheck,
  Copy, CheckCircle, Zap, Activity, BarChart3,
} from 'lucide-react'
import { txApi } from '../services/api'
import { format, formatDistanceToNow } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

interface Transaction {
  id: string; sender_id: string; sender_username?: string
  receiver_id: string; amount: number; currency: string
  status: string; payload_hash: string; created_at: string
}
interface Balance {
  sent_count: number; sent_total: number
  recv_count: number; recv_total: number; net_balance: number
}
type Tab = 'sent' | 'received'

const SYM: Record<string, string> = { INR:'₹', USD:'$', EUR:'€', GBP:'£', BTC:'₿', ETH:'Ξ' }
const fmt = (n: number, c: string) =>
  `${SYM[c]||''}${n.toLocaleString('en-IN',{maximumFractionDigits:2})} ${c}`

const STATUS_CONFIG: Record<string, { cls: string; dot: string; label: string }> = {
  verified: { cls: 'badge-green',  dot: 'bg-emerald-400', label: 'Verified' },
  pending:  { cls: 'badge-yellow', dot: 'bg-amber-400',   label: 'Pending'  },
  rejected: { cls: 'badge-red',    dot: 'bg-red-400',     label: 'Rejected' },
  tampered: { cls: 'badge-red',    dot: 'bg-red-400',     label: 'Tampered' },
}

// ── Animated counter ──────────────────────────────────────────────────────────
function AnimatedNumber({ value, prefix = '' }: { value: number; prefix?: string }) {
  const [display, setDisplay] = useState(0)
  const ref = useRef(value)
  useEffect(() => {
    const start = ref.current
    const end   = value
    const dur   = 800
    const t0    = performance.now()
    const step  = (t: number) => {
      const p = Math.min((t - t0) / dur, 1)
      const ease = 1 - Math.pow(1 - p, 3)
      setDisplay(start + (end - start) * ease)
      if (p < 1) requestAnimationFrame(step)
      else ref.current = end
    }
    requestAnimationFrame(step)
  }, [value])
  return <>{prefix}{display.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</>
}

// ── Mini sparkline ────────────────────────────────────────────────────────────
function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data)
  const W = 80, H = 32
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W
    const y = H - ((v - min) / (max - min + 0.01)) * H
    return `${x},${y}`
  }).join(' ')
  return (
    <svg width={W} height={H} className="opacity-70">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
  label, value, currency, count, icon: Icon,
  gradient, border, textColor, sparkData, delay = 0,
}: {
  label: string; value: number; currency?: string; count: number
  icon: React.ElementType; gradient: string; border: string
  textColor: string; sparkData?: number[]; delay?: number
}) {
  return (
    <div className={`stat-card ${border} animate-fade-in-up`}
         style={{ animationDelay: `${delay}ms`, background: gradient }}>
      {/* Glow blob */}
      <div className="absolute -top-6 -right-6 w-24 h-24 rounded-full opacity-20 blur-2xl"
           style={{ background: textColor }} />

      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wider">{label}</p>
          <p className={`text-2xl font-bold mt-1 ${textColor}`}>
            {currency
              ? <>{SYM[currency] || ''}<AnimatedNumber value={value} /></>
              : <AnimatedNumber value={value} />
            }
            {currency && <span className="text-sm font-normal ml-1 opacity-60">{currency}</span>}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {count} transaction{count !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className={`p-2 rounded-xl ${border} bg-white/5`}>
            <Icon size={18} className={textColor} />
          </div>
          {sparkData && <Sparkline data={sparkData} color={textColor} />}
        </div>
      </div>
    </div>
  )
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(id); setCopied(true); setTimeout(()=>setCopied(false),2000) }}
      className="text-gray-600 hover:text-blue-400 transition-colors ml-1 shrink-0">
      {copied ? <CheckCircle size={11} className="text-green-400" /> : <Copy size={11} />}
    </button>
  )
}

// ── Transaction row ───────────────────────────────────────────────────────────
function TxRow({ tx, type, onVerify, index }: {
  tx: Transaction; type: Tab; onVerify: (id: string) => void; index: number
}) {
  const isSent = type === 'sent'
  const sc     = STATUS_CONFIG[tx.status] || STATUS_CONFIG.pending

  return (
    <tr className="group border-b border-white/5 hover:bg-white/3 transition-all duration-150
                   animate-fade-in"
        style={{ animationDelay: `${index * 30}ms` }}>

      {/* Direction */}
      <td className="px-4 py-3.5 w-10">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center
                         ${isSent ? 'bg-red-500/10' : 'bg-emerald-500/10'}`}>
          {isSent
            ? <ArrowUpRight size={14} className="text-red-400" />
            : <ArrowDownLeft size={14} className="text-emerald-400" />}
        </div>
      </td>

      {/* ID */}
      <td className="px-2 py-3.5 max-w-[180px]">
        <div className="flex items-center">
          <code className="text-xs text-gray-400 font-mono truncate">{tx.id}</code>
          <CopyId id={tx.id} />
        </div>
      </td>

      {/* Counterparty */}
      <td className="px-2 py-3.5">
        <p className="text-[10px] text-gray-600 uppercase tracking-wider">{isSent ? 'To' : 'From'}</p>
        <p className="text-sm text-gray-200 font-medium truncate max-w-[120px]">
          {isSent ? tx.receiver_id : (tx.sender_username || tx.sender_id.slice(0,8)+'...')}
        </p>
      </td>

      {/* Amount */}
      <td className="px-2 py-3.5 text-right">
        <span className={`text-sm font-bold font-mono ${isSent ? 'text-red-300' : 'text-emerald-300'}`}>
          {isSent ? '−' : '+'}{fmt(tx.amount, tx.currency)}
        </span>
      </td>

      {/* Status */}
      <td className="px-2 py-3.5">
        <span className={`${sc.cls} flex items-center gap-1.5`}>
          <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
          {sc.label}
        </span>
      </td>

      {/* Time */}
      <td className="px-2 py-3.5">
        <p className="text-xs text-gray-400">{format(new Date(tx.created_at), 'MMM d, HH:mm')}</p>
        <p className="text-[10px] text-gray-600">
          {formatDistanceToNow(new Date(tx.created_at), { addSuffix: true })}
        </p>
      </td>

      {/* Action */}
      <td className="px-2 py-3.5">
        <button onClick={() => onVerify(tx.id)}
          className="opacity-0 group-hover:opacity-100 transition-opacity
                     w-7 h-7 rounded-lg bg-blue-500/10 hover:bg-blue-500/20
                     flex items-center justify-center text-blue-400">
          <ArrowRight size={13} />
        </button>
      </td>
    </tr>
  )
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function TransactionsPage() {
  const { username } = useAuth()
  const [tab, setTab]           = useState<Tab>('sent')
  const [sent, setSent]         = useState<Transaction[]>([])
  const [received, setReceived] = useState<Transaction[]>([])
  const [balance, setBalance]   = useState<Balance | null>(null)
  const [loading, setLoading]   = useState(false)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, r, b] = await Promise.all([txApi.list(), txApi.received(), txApi.balance()])
      setSent(s.data); setReceived(r.data); setBalance(b.data)
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const activeTxs = tab === 'sent' ? sent : received

  // Sparkline data from transactions
  const sentSpark = sent.slice(-8).map(t => t.amount)
  const recvSpark = received.slice(-8).map(t => t.amount)

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="space-y-6 max-w-6xl mx-auto">

      {/* ── Welcome header ── */}
      <div className="animate-fade-in-up flex items-start justify-between">
        <div>
          <p className="text-gray-500 text-sm">{greeting},</p>
          <h1 className="text-2xl font-bold text-white mt-0.5">
            {username} <span className="wave">👋</span>
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            Here's your transaction overview
          </p>
        </div>
        <button onClick={load}
          className="btn-secondary flex items-center gap-2 text-sm">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* ── Stat cards ── */}
      {loading && !balance ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[0,1,2].map(i => <div key={i} className="skeleton h-28 rounded-2xl" />)}
        </div>
      ) : balance ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label="Total Sent" value={balance.sent_total} currency="INR"
            count={balance.sent_count} icon={ArrowUpRight}
            gradient="linear-gradient(135deg, rgba(239,68,68,0.08) 0%, rgba(15,23,42,0.8) 100%)"
            border="border-red-500/20" textColor="#f87171"
            sparkData={sentSpark} delay={0}
          />
          <StatCard
            label="Total Received" value={balance.recv_total} currency="INR"
            count={balance.recv_count} icon={ArrowDownLeft}
            gradient="linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(15,23,42,0.8) 100%)"
            border="border-emerald-500/20" textColor="#34d399"
            sparkData={recvSpark} delay={100}
          />
          <StatCard
            label="Net Balance" value={Math.abs(balance.net_balance)} currency="INR"
            count={balance.sent_count + balance.recv_count}
            icon={balance.net_balance >= 0 ? TrendingUp : TrendingDown}
            gradient="linear-gradient(135deg, rgba(59,130,246,0.08) 0%, rgba(15,23,42,0.8) 100%)"
            border="border-blue-500/20"
            textColor={balance.net_balance >= 0 ? '#60a5fa' : '#fb923c'}
            delay={200}
          />
        </div>
      ) : null}

      {/* ── Quick actions ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-fade-in-up delay-300">
        {[
          { label: 'Sign Transaction', icon: Send,         to: '/sign',   color: 'from-blue-600/20 to-blue-600/5',   border: 'border-blue-500/20',    text: 'text-blue-400' },
          { label: 'Verify',           icon: ShieldCheck,  to: '/verify', color: 'from-emerald-600/20 to-emerald-600/5', border: 'border-emerald-500/20', text: 'text-emerald-400' },
          { label: 'Generate Keys',    icon: Zap,          to: '/keys',   color: 'from-amber-600/20 to-amber-600/5', border: 'border-amber-500/20',   text: 'text-amber-400' },
          { label: 'Audit Logs',       icon: Activity,     to: '/audit',  color: 'from-purple-600/20 to-purple-600/5', border: 'border-purple-500/20',  text: 'text-purple-400' },
        ].map(({ label, icon: Icon, to, color, border, text }) => (
          <button key={to} onClick={() => navigate(to)}
            className={`flex items-center gap-3 p-3.5 rounded-xl border ${border}
                        bg-gradient-to-br ${color} hover:scale-[1.02] active:scale-[0.98]
                        transition-all duration-150 text-left group`}>
            <div className={`p-2 rounded-lg bg-white/5 ${text} group-hover:scale-110 transition-transform`}>
              <Icon size={16} />
            </div>
            <span className={`text-sm font-medium ${text}`}>{label}</span>
          </button>
        ))}
      </div>

      {/* ── Transaction table ── */}
      <div className="card-glow animate-fade-in-up delay-400 p-0 overflow-hidden">

        {/* Header */}
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 size={18} className="text-blue-400" />
            <h2 className="font-semibold text-white">Transaction History</h2>
          </div>
          <div className="flex gap-1 bg-gray-800/60 rounded-xl p-1">
            {(['sent','received'] as Tab[]).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium
                             transition-all duration-150 ${
                  tab === t
                    ? t === 'sent'
                      ? 'bg-red-500/20 text-red-300 shadow-sm'
                      : 'bg-emerald-500/20 text-emerald-300 shadow-sm'
                    : 'text-gray-500 hover:text-gray-300'
                }`}>
                {t === 'sent' ? <Send size={11} /> : <Inbox size={11} />}
                {t.charAt(0).toUpperCase() + t.slice(1)}
                <span className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                  tab === t ? 'bg-white/10' : 'bg-gray-700'
                }`}>
                  {t === 'sent' ? sent.length : received.length}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-4 py-3 w-10" />
                <th className="text-left px-2 py-3 text-[11px] text-gray-500 font-semibold uppercase tracking-wider">Transaction ID</th>
                <th className="text-left px-2 py-3 text-[11px] text-gray-500 font-semibold uppercase tracking-wider">
                  {tab === 'sent' ? 'Recipient' : 'Sender'}
                </th>
                <th className="text-right px-2 py-3 text-[11px] text-gray-500 font-semibold uppercase tracking-wider">Amount</th>
                <th className="text-left px-2 py-3 text-[11px] text-gray-500 font-semibold uppercase tracking-wider">Status</th>
                <th className="text-left px-2 py-3 text-[11px] text-gray-500 font-semibold uppercase tracking-wider">Time</th>
                <th className="px-2 py-3 w-10" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({length: 4}).map((_, i) => (
                  <tr key={i} className="border-b border-white/5">
                    {Array.from({length: 7}).map((_, j) => (
                      <td key={j} className="px-2 py-4">
                        <div className="skeleton h-4 rounded" style={{ width: `${60 + Math.random()*40}%` }} />
                      </td>
                    ))}
                  </tr>
                ))
              ) : activeTxs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-16">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-14 h-14 rounded-2xl bg-gray-800 flex items-center justify-center">
                        {tab === 'sent' ? <Send size={24} className="text-gray-600" /> : <Inbox size={24} className="text-gray-600" />}
                      </div>
                      <p className="text-gray-500 text-sm">
                        {tab === 'sent' ? 'No transactions yet' : 'No received transactions'}
                      </p>
                      {tab === 'sent' && (
                        <button onClick={() => navigate('/sign')}
                          className="btn-primary text-xs py-1.5 px-4 flex items-center gap-1.5">
                          <Send size={12} /> Sign your first transaction
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                activeTxs.map((tx, i) => (
                  <TxRow key={tx.id} tx={tx} type={tab}
                    onVerify={id => navigate(`/verify?id=${id}`)} index={i} />
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer hint */}
        {tab === 'received' && activeTxs.length === 0 && (
          <div className="px-5 py-3 border-t border-white/5 bg-blue-500/5">
            <p className="text-xs text-blue-400/70">
              💡 Share your username <strong className="text-blue-300">{username}</strong> with senders as the Receiver ID
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
