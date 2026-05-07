import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'

interface AuthState {
  token:          string | null
  userId:         string | null
  username:       string | null
  faceRegistered: boolean
  profileImage:   string | null
  authProvider:   string | null
}

interface AuthContextType extends AuthState {
  login: (
    token: string,
    userId: string,
    username: string,
    faceRegistered?: boolean,
    profileImage?: string | null,
    authProvider?: string,
  ) => void
  setFaceRegistered: (val: boolean) => void
  logout: () => void
  isAuthenticated: boolean
  token: string | null   // expose directly for guards
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(() => ({
    token:          localStorage.getItem('token'),
    userId:         localStorage.getItem('userId'),
    username:       localStorage.getItem('username'),
    faceRegistered: localStorage.getItem('faceRegistered') === 'true',
    profileImage:   localStorage.getItem('profileImage'),
    authProvider:   localStorage.getItem('authProvider'),
  }))

  const login = (
    token:          string,
    userId:         string,
    username:       string,
    faceRegistered: boolean = false,
    profileImage:   string | null = null,
    authProvider:   string = 'local',
  ) => {
    localStorage.setItem('token',          token)
    localStorage.setItem('userId',         userId)
    localStorage.setItem('username',       username)
    localStorage.setItem('faceRegistered', String(faceRegistered))
    localStorage.setItem('profileImage',   profileImage || '')
    localStorage.setItem('authProvider',   authProvider)
    setAuth({ token, userId, username, faceRegistered, profileImage, authProvider })
  }

  const setFaceRegistered = (val: boolean) => {
    localStorage.setItem('faceRegistered', String(val))
    setAuth((a) => ({ ...a, faceRegistered: val }))
  }

  const logout = () => {
    localStorage.clear()
    setAuth({
      token: null, userId: null, username: null,
      faceRegistered: false, profileImage: null, authProvider: null,
    })
  }

  return (
    <AuthContext.Provider value={{
      ...auth,
      login,
      setFaceRegistered,
      logout,
      isAuthenticated: !!auth.token,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
