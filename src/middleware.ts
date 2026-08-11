import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  const token = req.cookies.get(COOKIE_NAME)?.value

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