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

    // Build response with httpOnly cookie
    const cookie = sessionCookie(token)
    return NextResponse.json(
      {
        success: true,
        token,
        user: { id: user.id, email: user.email, nickname: user.nickname },
      },
      {
        headers: {
          'Set-Cookie': `${cookie.name}=${cookie.value}; HttpOnly; ${cookie.secure ? 'Secure; ' : ''}SameSite=${cookie.sameSite}; Path=${cookie.path}; Max-Age=${cookie.maxAge}`,
        },
      }
    )
  } catch (err: any) {
    const msg = err?.message || 'Invalid credentials'
    return NextResponse.json({ error: msg === 'Wrong password' ? 'Invalid email or password' : msg }, { status: 401 })
  }
}
