import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'

function getTokenFromRequest(req: NextRequest): string | undefined {
  // Try NextRequest cookies API first
  const fromCookies = req.cookies.get(COOKIE_NAME)?.value
  if (fromCookies) return fromCookies

  // Fallback: parse raw Cookie header manually (for standalone server compat)
  const cookieHeader = req.headers.get('cookie') || ''
  const match = cookieHeader.split(';').find(c => c.trim().startsWith(`${COOKIE_NAME}=`))
  if (match) {
    return match.split('=').slice(1).join('=').trim()
  }
  return undefined
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const token = getTokenFromRequest(req)

  // Public routes (no auth required)
  const publicRoutes = ['/login', '/signup', '/api/auth']
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route))
  const isStaticAsset = pathname.startsWith('/_next') || pathname.startsWith('/icons') || pathname === '/manifest.json' || pathname === '/sw.js'

  if (isStaticAsset || isPublicRoute) return NextResponse.next()

  // Verify JWT
  let isAuthenticated = false
  if (token) {
    const user = await verifyToken(token)
    if (user) isAuthenticated = true
  }

  // Protected routes — redirect to login if not authenticated
  if (!isAuthenticated && pathname === '/') {
    const loginUrl = new URL('/login', req.url)
    return NextResponse.redirect(loginUrl)
  }

  // If logged in and trying to access auth pages, redirect to home
  if (isAuthenticated && (pathname === '/login' || pathname === '/signup')) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/).*)'],
}