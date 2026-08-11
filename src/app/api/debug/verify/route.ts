import { NextRequest, NextResponse } from 'next/server'
import { verifyToken } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : ''
  
  try {
    const user = await verifyToken(token)
    return NextResponse.json({ tokenPrefix: token.slice(0, 20), user })
  } catch (e: any) {
    return NextResponse.json({ error: e.message })
  }
}