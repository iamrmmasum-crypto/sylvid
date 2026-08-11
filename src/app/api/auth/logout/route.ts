import { NextResponse } from 'next/server'

export async function POST() {
  // No server-side state to clear — client removes token from localStorage
  return NextResponse.json({ success: true })
}
