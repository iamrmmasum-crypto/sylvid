export async function register() {
  if (process.env.NODE_ENV === 'production') {
    const port = process.env.PORT || 8080
    // Self-ping every 4 minutes to prevent Railway serverless sleep
    setInterval(async () => {
      try {
        const res = await fetch(`http://localhost:${port}/api/health`)
        if (res.ok) console.log(`[Sylvid] Keep-alive ping OK`)
      } catch (e: any) {
        console.error(`[Sylvid] Keep-alive ping failed:`, e.message)
      }
    }, 4 * 60 * 1000) // every 4 minutes
    console.log(`[Sylvid] Keep-alive registered (ping every 4min to :${port})`)
  }
}
