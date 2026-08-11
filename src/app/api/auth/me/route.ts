import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value
  if (!token) {
    return NextResponse.json({ user: null }, { status: 401 })
  }

  const user = await verifyToken(token)
  if (!user) {
    // Token expired or invalid — clear it
    const res = NextResponse.json({ user: null }, { status: 401 })
    res.cookies.set({ name: COOKIE_NAME, value: '', path: '/', maxAge: 0 })
    return res
  }

  return NextResponse.json({ user })
}