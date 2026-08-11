import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const cookieStore = await cookies()
    const all = cookieStore.getAll()
    const sylvid = cookieStore.get('sylvid-token')
    return NextResponse.json({
      method: 'next/headers cookies()',
      allCookies: all.map(c => c.name),
      sylvidToken: sylvid ? sylvid.value.slice(0, 30) + '...' : null,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message })
  }
}
