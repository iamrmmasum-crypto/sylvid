import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'
import { jwtVerify } from 'jose'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const secret = process.env.AUTH_SECRET || 'sylvid-dev-secret-change-in-production'
  
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret))
    return NextResponse.json({ ok: true, payload })
  } catch (e: any) {
    return NextResponse.json({ 
      ok: false, 
      error: e.message,
      secretLength: secret.length,
      secretPrefix: secret.slice(0, 10),
      tokenLength: token.length,
    })
  }
}