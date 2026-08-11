import { NextResponse } from 'next/server'
import { logoutCookie } from '@/lib/auth'

export async function POST() {
  const res = NextResponse.json({ success: true })
  res.cookies.set(logoutCookie())
  return res
}