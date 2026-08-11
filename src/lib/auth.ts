import { SignJWT, jwtVerify } from 'jose'

const AUTH_SECRET = process.env.AUTH_SECRET || 'sylvid-dev-secret-change-in-production'

// Convert secret to Uint8Array for jose
function getSecret() {
  return new TextEncoder().encode(AUTH_SECRET)
}

export interface AuthUser {
  id: string
  email: string
  nickname: string
}

export interface AuthSession {
  user: AuthUser
}

const COOKIE_NAME = 'sylvid-token'
const MAX_AGE = 30 * 24 * 60 * 60 // 30 days in seconds

/** Sign a JWT and return the token string */
export async function signToken(user: AuthUser): Promise<string> {
  return new SignJWT({ id: user.id, email: user.email, nickname: user.nickname })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(MAX_AGE)
    .sign(getSecret())
}

/** Verify a JWT token string and return the payload */
export async function verifyToken(token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret())
    return {
      id: payload.id as string,
      email: payload.email as string,
      nickname: payload.nickname as string,
    }
  } catch {
    return null
  }
}

/** Create the session cookie options */
export function sessionCookie(token: string) {
  return {
    name: COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: MAX_AGE,
  }
}

/** Create a cookie that clears the session */
export function logoutCookie() {
  return {
    name: COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 0,
  }
}

export { COOKIE_NAME }
