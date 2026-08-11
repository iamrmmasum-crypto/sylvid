import bcrypt from 'bcryptjs'

export interface StoredUser {
  id: string
  email: string
  passwordHash: string
  nickname: string
  createdAt: number
}

// In-memory user store (survives hot reloads via globalThis, lost on server restart)
// For production with Railway, this is fine — same behavior as signaling state

type UserStore = Map<string, StoredUser> // key = email (lowercase)

const g = globalThis as unknown as { __sylvidUsers?: UserStore }
if (!g.__sylvidUsers) {
  g.__sylvidUsers = new Map()
}
const store = g.__sylvidUsers

export async function createUser(email: string, password: string, nickname: string): Promise<StoredUser> {
  const key = email.toLowerCase()
  if (store.has(key)) throw new Error('Email already registered')
  const passwordHash = await bcrypt.hash(password, 12)
  const user: StoredUser = {
    id: `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    email: key,
    passwordHash,
    nickname: nickname.trim() || email.split('@')[0],
    createdAt: Date.now(),
  }
  store.set(key, user)
  console.log(`[Auth] User created: ${user.email} (${user.nickname})`)
  return user
}

export async function verifyUser(email: string, password: string): Promise<StoredUser> {
  const key = email.toLowerCase()
  const user = store.get(key)
  if (!user) throw new Error('Email not found')
  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) throw new Error('Wrong password')
  console.log(`[Auth] User verified: ${user.email} (${user.nickname})`)
  return user
}

export function getUser(email: string): StoredUser | undefined {
  return store.get(email.toLowerCase())
}

export function updateUserNickname(email: string, nickname: string): StoredUser | undefined {
  const user = store.get(email.toLowerCase())
  if (user) { user.nickname = nickname.trim() || user.nickname; store.set(email.toLowerCase(), user) }
  return user
}

export function getAllUsersCount(): number {
  return store.size
}
