import 'dotenv/config'
import { createApp } from './app.js'
import { connectDatabase } from './config/db.js'
import { provisionAdmin } from './services/admin.js'
import { logger } from './config/logger.js'

const port = Number(process.env.PORT || 5000)
const missing = ['MONGODB_URI', 'JWT_SECRET'].filter(
  (name) => !process.env[name],
)
if (missing.length) {
  logger.error(`Missing required environment variables: ${missing.join(', ')}`)
  process.exit(1)
}
if (process.env.JWT_SECRET.length < 32)
  logger.warn(
    'JWT_SECRET is shorter than 32 characters. Use a longer random value in production.',
  )

async function start() {
  if (process.env.NODE_ENV === 'production') {
    if (process.env.OTP_DEV_BYPASS === 'true')
      throw new Error('OTP_DEV_BYPASS must be false in production.')
    if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL)
      throw new Error(
        'Production requires BREVO_API_KEY and BREVO_SENDER_EMAIL.',
      )
    if (!process.env.CLIENT_URL?.startsWith('https://'))
      throw new Error('Production requires an HTTPS CLIENT_URL.')
    if (process.env.JWT_SECRET.length < 32)
      throw new Error(
        'Production requires a JWT_SECRET of at least 32 characters.',
      )
  }
  await connectDatabase()
  await provisionAdmin()
  const server = createApp().listen(port, () =>
    logger.info(`Garbhika API running on port ${port}`),
  )
  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(1), 10000).unref()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

start().catch((error) => {
  logger.error('Failed to start Garbhika API', { error: error.message })
  process.exit(1)
})
