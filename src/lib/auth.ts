import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { verifyUser, createUser, type StoredUser } from './user-store'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      nickname: string
    }
  }
  interface User extends StoredUser {}
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    email: string
    nickname: string
  }
}

const AUTH_SECRET = process.env.AUTH_SECRET || 'sylvid-dev-secret-change-in-production'

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: AUTH_SECRET,
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        nickname: { label: 'Nickname', type: 'text' },
        isSignup: { label: 'Signup', type: 'text' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const email = credentials.email as string
        const password = credentials.password as string
        const isSignup = credentials.isSignup === 'true'

        try {
          if (isSignup) {
            // Signup flow
            const nickname = (credentials.nickname as string)?.trim()
            if (!nickname) throw new Error('Nickname is required')
            if (password.length < 4) throw new Error('Password must be at least 4 characters')
            return await createUser(email, password, nickname)
          } else {
            // Login flow
            return await verifyUser(email, password)
          }
        } catch (err: any) {
          console.error('[Auth] authorize error:', err.message)
          return null
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: '/login',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.email = user.email
        token.nickname = user.nickname
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.email = token.email as string
        session.user.nickname = token.nickname as string
      }
      return session
    },
  },
})
