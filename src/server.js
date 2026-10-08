import 'dotenv/config'
import { createApp } from './app.js'
import { connectDatabase } from './config/db.js'

const port = Number(process.env.PORT || 5000)

async function start() {
  await connectDatabase()
  createApp().listen(port, () => console.log(`Garbhika API running on port ${port}`))
}

start().catch((error) => {
  console.error('Failed to start Garbhika API:', error.message)
  process.exit(1)
})
