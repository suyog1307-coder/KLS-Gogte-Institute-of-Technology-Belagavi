import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'

interface AuthState {
  token: string | null
  userId: string | null
  username: string | null
}

interface AuthContextType extends AuthState {
  login: (token: string, userId: string, username: string) => void
  logout: () => void
  isAuthenticated: boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(() => ({
    token: localStorage.getItem('token'),
    userId: localStorage.getItem('userId'),
    username: localStorage.getItem('username'),
  }))

  const login = (token: string, userId: string, username: string) => {
    localStorage.setItem('token', token)
    localStorage.setItem('userId', userId)
    localStorage.setItem('username', username)
    setAuth({ token, userId, username })
  }

  const logout = () => {
    localStorage.clear()
    setAuth({ token: null, userId: null, username: null })
  }

  return (
    <AuthContext.Provider value={{ ...auth, login, logout, isAuthenticated: !!auth.token }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
