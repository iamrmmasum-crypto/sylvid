import { NextResponse } from 'next/server'
import { logoutCookie, COOKIE_NAME } from '@/lib/auth'

export async function POST() {
  const cookie = logoutCookie()
  return NextResponse.json(
    { success: true },
    {
      headers: {
        'Set-Cookie': `${cookie.name}=; HttpOnly; ${cookie.secure ? 'Secure; ' : ''}SameSite=${cookie.sameSite}; Path=${cookie.path}; Max-Age=0`,
      },
    }
  )
}
