import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { verifyToken, COOKIE_NAME } from '@/lib/auth'
import HomeClient from './home-client'

export const dynamic = 'force-dynamic'

export default async function VideoCallPage() {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value

  if (!token) {
    redirect('/login')
  }

  const user = await verifyToken(token)
  if (!user) {
    redirect('/login')
  }

  return <HomeClient serverUser={user} />
}
