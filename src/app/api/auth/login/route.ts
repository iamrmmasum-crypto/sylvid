import { NextRequest, NextResponse } from 'next/server'
import { verifyUser } from '@/lib/user-store'
import { signToken, sessionCookie } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    const user = await verifyUser(email, password)

    const token = await signToken({ id: user.id, email: user.email, nickname: user.nickname })
    const res = NextResponse.json({ success: true, user: { id: user.id, email: user.email, nickname: user.nickname } })
    res.cookies.set(sessionCookie(token))
    return res
  } catch (err: any) {
    const msg = err?.message || 'Invalid credentials'
    return NextResponse.json({ error: msg === 'Wrong password' ? 'Invalid email or password' : msg }, { status: 401 })
  }
}