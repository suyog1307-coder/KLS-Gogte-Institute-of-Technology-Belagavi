import React from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  KeyRound, Send, ShieldCheck, List, ScrollText, LogOut, Lock, ScanFace
} from 'lucide-react'

const navItems = [
  { to: '/transactions', icon: List,       label: 'Transactions' },
  { to: '/sign',         icon: Send,       label: 'Sign Transaction' },
  { to: '/verify',       icon: ShieldCheck, label: 'Verify' },
  { to: '/face',         icon: ScanFace,   label: 'Face Enrollment' },
  { to: '/keys',         icon: KeyRound,   label: 'Key Management' },
  { to: '/audit',        icon: ScrollText, label: 'Audit Logs' },
]

export default function Layout() {
  const { username, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="p-6 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Lock className="text-blue-500" size={22} />
            <span className="font-bold text-lg text-white">TxSign</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">Secure Transaction System</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-800/50'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-800">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-white">{username}</p>
              <p className="text-xs text-gray-500">Authenticated</p>
            </div>
            <button
              onClick={handleLogout}
              className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-800 rounded-lg transition-colors"
              title="Logout"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-gray-950 p-8">
        <Outlet />
      </main>
    </div>
  )
}
