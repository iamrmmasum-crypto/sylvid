import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const rawHeader = req.headers.get('cookie') || '(none)'
  const parsed = req.cookies.getAll().map(c => `${c.name}=${c.value.slice(0, 30)}...`).join('; ') || '(none)'
  
  return NextResponse.json({
    rawCookieHeader: rawHeader,
    parsedCookies: parsed,
  })
}