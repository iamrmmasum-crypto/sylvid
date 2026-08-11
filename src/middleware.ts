import { NextResponse } from 'next/server'

// Auth is now handled by server component in page.tsx using cookies()
// Middleware is kept minimal since req.cookies is unreliable in standalone mode

export function middleware() {
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/).*)'],
}
