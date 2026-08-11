import { NextResponse } from 'next/server'

const METERED_API_KEY = '0bccf96e655255d417d80e3d2b55949cdd32'
const METERED_API_URL = 'https://sylvid.metered.live/api/v1/turn/credentials'

// Cache TURN credentials for 5 minutes (they're short-lived)
let cached: { servers: RTCIceServer[]; fetchedAt: number } | null = null
const CACHE_TTL = 5 * 60 * 1000

export async function GET() {
  try {
    // Return cached if fresh
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      return NextResponse.json(cached.servers)
    }

    const res = await fetch(`${METERED_API_URL}?apiKey=${METERED_API_KEY}`)
    if (!res.ok) {
      console.error(`[Sylvid] TURN API error: ${res.status}`)
      return NextResponse.json([], { status: 200 }) // graceful fallback
    }

    const servers = await res.json()
    cached = { servers, fetchedAt: Date.now() }
    console.log(`[Sylvid] TURN: fetched ${servers.length} servers from Metered`)
    return NextResponse.json(servers)
  } catch (err) {
    console.error('[Sylvid] TURN fetch error:', err)
    return NextResponse.json([], { status: 200 }) // graceful fallback
  }
}
