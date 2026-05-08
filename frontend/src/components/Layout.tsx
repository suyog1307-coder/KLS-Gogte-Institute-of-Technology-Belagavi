import React, { useState } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  LayoutDashboard, Send, ShieldCheck, ScrollText,
  LogOut, Lock, ScanFace, KeyRound, Menu, X,
  ChevronRight, Bell, Settings,
} from 'lucide-react'

const navItems = [
  { to: '/transactions', icon: LayoutDashboard, label: 'Dashboard',       color: 'text-blue-400',   bg: 'bg-blue-500/10' },
  { to: '/sign',         icon: Send,            label: 'Sign Transaction', color: 'text-purple-400', bg: 'bg-purple-500/10' },
  { to: '/verify',       icon: ShieldCheck,     label: 'Verify',           color: 'text-emerald-400',bg: 'bg-emerald-500/10' },
  { to: '/face',         icon: ScanFace,        label: 'Face ID',          color: 'text-pink-400',   bg: 'bg-pink-500/10' },
  { to: '/keys',         icon: KeyRound,        label: 'Key Management',   color: 'text-amber-400',  bg: 'bg-amber-500/10' },
  { to: '/audit',        icon: ScrollText,      label: 'Audit Logs',       color: 'text-cyan-400',   bg: 'bg-cyan-500/10' },
]

export default function Layout() {
  const { username, profileImage, logout } = useAuth()
  const navigate  = useNavigate()
  const location  = useLocation()
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const handleLogout = () => { logout(); navigate('/login') }

  const currentPage = navItems.find(n => location.pathname.startsWith(n.to))

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0f1e]">

      {/* ── Sidebar ── */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-16'} flex-shrink-0 flex flex-col
                         glass border-r border-white/5 transition-all duration-300 ease-in-out
                         relative z-20`}>

        {/* Logo */}
        <div className="p-4 border-b border-white/5 flex items-center justify-between">
          <div className={`flex items-center gap-3 overflow-hidden ${sidebarOpen ? '' : 'justify-center'}`}>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600
                            flex items-center justify-center shadow-lg shadow-blue-900/40 shrink-0">
              <Lock size={18} className="text-white" />
            </div>
            {sidebarOpen && (
              <div className="animate-fade-in">
                <p className="font-bold text-white text-sm leading-none">TxSign</p>
                <p className="text-[10px] text-gray-500 mt-0.5">Secure · Verified</p>
              </div>
            )}
          </div>
          <button onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-gray-500 hover:text-white transition-colors p-1 rounded-lg
                       hover:bg-white/5 shrink-0">
            {sidebarOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map(({ to, icon: Icon, label, color, bg }, i) => (
            <NavLink key={to} to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
                 transition-all duration-150 group relative overflow-hidden
                 ${isActive
                   ? `${bg} ${color} shadow-sm`
                   : 'text-gray-500 hover:text-gray-200 hover:bg-white/5'
                 }`
              }
              style={{ animationDelay: `${i * 50}ms` }}
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5
                                    rounded-r-full bg-current" />
                  )}
                  <Icon size={18} className="shrink-0" />
                  {sidebarOpen && (
                    <span className="animate-fade-in flex-1">{label}</span>
                  )}
                  {sidebarOpen && isActive && (
                    <ChevronRight size={14} className="opacity-60" />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div className="p-3 border-t border-white/5">
          <div className={`flex items-center gap-3 px-2 py-2 rounded-xl
                           hover:bg-white/5 transition-colors cursor-default
                           ${sidebarOpen ? '' : 'justify-center'}`}>
            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600
                            flex items-center justify-center text-white text-xs font-bold shrink-0
                            ring-2 ring-blue-500/30">
              {profileImage
                ? <img src={profileImage} alt="" className="w-full h-full rounded-full object-cover" />
                : (username?.[0] || 'U').toUpperCase()
              }
            </div>
            {sidebarOpen && (
              <div className="flex-1 min-w-0 animate-fade-in">
                <p className="text-sm font-medium text-white truncate">{username}</p>
                <p className="text-xs text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                  Active
                </p>
              </div>
            )}
            {sidebarOpen && (
              <button onClick={handleLogout}
                className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10
                           rounded-lg transition-colors"
                title="Logout">
                <LogOut size={15} />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top bar */}
        <header className="glass border-b border-white/5 px-6 py-3 flex items-center
                           justify-between shrink-0">
          <div>
            <h1 className="text-base font-semibold text-white">
              {currentPage?.label || 'Dashboard'}
            </h1>
            <p className="text-xs text-gray-500">
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10
                            border border-emerald-500/20 text-xs text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              System Online
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
