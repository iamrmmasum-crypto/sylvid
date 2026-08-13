import { NextResponse } from 'next/server'

const METERED_API_KEY = '0bccf96e655255d417d80e3d2b55949cdd32'
const METERED_API_URL = 'https://sylvid.metered.live/api/v1/turn/credentials'

// Cache TURN credentials for 5 minutes (they're short-lived)
let cached: { servers: RTCIceServer[]; fetchedAt: number } | null = null
const CACHE_TTL = 5 * 60 * 1000

// Free Open Relay TURN servers (no API key needed, always available as fallback)
const OPEN_RELAY_SERVERS: RTCIceServer[] = [
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
]

export async function GET() {
  try {
    // Return cached if fresh
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      return NextResponse.json(cached.servers)
    }

    const res = await fetch(`${METERED_API_URL}?apiKey=${METERED_API_KEY}`)
    if (!res.ok) {
      console.error(`[Sylvid] TURN API error: ${res.status} — using Open Relay fallback`)
      return NextResponse.json(OPEN_RELAY_SERVERS)
    }

    const servers = await res.json()
    // Always append Open Relay as fallback in case Metered servers fail on certain networks
    const allServers = [...servers, ...OPEN_RELAY_SERVERS]
    cached = { servers: allServers, fetchedAt: Date.now() }
    console.log(`[Sylvid] TURN: fetched ${servers.length} from Metered + ${OPEN_RELAY_SERVERS.length} Open Relay fallback`)
    return NextResponse.json(allServers)
  } catch (err) {
    console.error('[Sylvid] TURN fetch error:', err)
    return NextResponse.json(OPEN_RELAY_SERVERS)
  }
}
