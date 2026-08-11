import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'

function getToken(req: NextRequest): string | undefined {
  // Try req.cookies first
  const fromCookies = req.cookies.get(COOKIE_NAME)?.value
  if (fromCookies) return fromCookies
  // Fallback: parse raw Cookie header (standalone server compat)
  const header = req.headers.get('cookie') || ''
  const match = header.split(';').find(c => c.trim().startsWith(`${COOKIE_NAME}=`))
  return match ? match.split('=').slice(1).join('=').trim() : undefined
}

export async function GET(req: NextRequest) {
  const token = getToken(req)
  if (!token) {
    return NextResponse.json({ user: null }, { status: 401 })
  }

  const user = await verifyToken(token)
  if (!user) {
    const res = NextResponse.json({ user: null }, { status: 401 })
    res.cookies.set({ name: COOKIE_NAME, value: '', path: '/', maxAge: 0 })
    return res
  }

  return NextResponse.json({ user })
}
