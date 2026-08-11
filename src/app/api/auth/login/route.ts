import { NextRequest, NextResponse } from 'next/server'
import { verifyUser } from '@/lib/user-store'
import { signToken } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    const user = await verifyUser(email, password)
    const token = await signToken({ id: user.id, email: user.email, nickname: user.nickname })

    // Return token in response body — client stores in localStorage
    return NextResponse.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, nickname: user.nickname },
    })
  } catch (err: any) {
    const msg = err?.message || 'Invalid credentials'
    return NextResponse.json({ error: msg === 'Wrong password' ? 'Invalid email or password' : msg }, { status: 401 })
  }
}
