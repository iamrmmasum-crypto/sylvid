import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const { pathname } = req.nextUrl
  const isLoggedIn = !!req.auth

  // Public routes (no auth required)
  const publicRoutes = ['/login', '/signup', '/api/auth']
  const isPublicRoute = publicRoutes.some(route => pathname.startsWith(route))
  const isStaticAsset = pathname.startsWith('/_next') || pathname.startsWith('/icons') || pathname === '/manifest.json' || pathname === '/sw.js'

  if (isStaticAsset || isPublicRoute) return NextResponse.next()

  // Protected routes — redirect to login if not authenticated
  if (!isLoggedIn && pathname === '/') {
    const loginUrl = new URL('/login', req.url)
    return NextResponse.redirect(loginUrl)
  }

  // If logged in and trying to access auth pages, redirect to home
  if (isLoggedIn && (pathname === '/login' || pathname === '/signup')) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/).*)'],
}