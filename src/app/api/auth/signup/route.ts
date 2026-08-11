import { NextRequest, NextResponse } from 'next/server'
import { createUser } from '@/lib/user-store'
import { signToken } from '@/lib/auth'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password, nickname } = body

    if (!email || !password || !nickname) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
    }
    if (password.length < 4) {
      return NextResponse.json({ error: 'Password must be at least 4 characters' }, { status: 400 })
    }
    if (nickname.trim().length < 2) {
      return NextResponse.json({ error: 'Nickname must be at least 2 characters' }, { status: 400 })
    }

    const user = await createUser(email, password, nickname.trim())
    const token = await signToken({ id: user.id, email: user.email, nickname: user.nickname })

    return NextResponse.json({
      success: true,
      token,
      user: { id: user.id, email: user.email, nickname: user.nickname },
    })
  } catch (err: any) {
    const msg = err?.message || 'Signup failed'
    const status = msg === 'Email already registered' ? 409 : 400
    return NextResponse.json({ error: msg }, { status })
  }
}
