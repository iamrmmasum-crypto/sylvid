'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { useRouter } from 'next/navigation'

export interface AuthUser {
  id: string
  email: string
  nickname: string
}

interface AuthContextValue {
  user: AuthUser | null
  status: 'loading' | 'authenticated' | 'unauthenticated'
  logout: () => void
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  status: 'loading',
  logout: () => {},
})

const TOKEN_KEY = 'sylvid-token'
const USER_KEY = 'sylvid-user'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading')
  const router = useRouter()

  // Check localStorage on mount, verify token with server
  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY)
    const storedUser = localStorage.getItem(USER_KEY)

    if (!storedToken || !storedUser) {
      setStatus('unauthenticated')
      return
    }

    // Verify token is still valid via server
    fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${storedToken}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Invalid')
        return res.json()
      })
      .then((data) => {
        if (data.user) {
          setUser(data.user)
          setStatus('authenticated')
        } else {
          localStorage.removeItem(TOKEN_KEY)
          localStorage.removeItem(USER_KEY)
          setStatus('unauthenticated')
        }
      })
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY)
        localStorage.removeItem(USER_KEY)
        setStatus('unauthenticated')
      })
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    setUser(null)
    setStatus('unauthenticated')
    router.push('/login')
  }, [router])

  return (
    <AuthContext.Provider value={{ user, status, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

/** Helper: save token+user after login/signup */
export function saveAuth(token: string, user: AuthUser) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

/** Helper: get stored token for API calls */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function useAuth() {
  return useContext(AuthContext)
}
