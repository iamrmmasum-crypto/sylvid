import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'

export async function GET(req: NextRequest) {
  // Try Authorization header first, then cookie
  const authHeader = req.headers.get('authorization')
  let token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined

  if (!token) {
    token = req.cookies.get(COOKIE_NAME)?.value
  }

  if (!token) {
    return NextResponse.json({ user: null }, { status: 401 })
  }

  const user = await verifyToken(token)
  if (!user) {
    return NextResponse.json({ user: null }, { status: 401 })
  }

  return NextResponse.json({ user })
}
