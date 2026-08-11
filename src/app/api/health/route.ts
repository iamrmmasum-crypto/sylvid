import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 5

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'sylvid',
    timestamp: Date.now(),
    uptime: process.uptime ? Math.floor(process.uptime()) : null,
  })
}
