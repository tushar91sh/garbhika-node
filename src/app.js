import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import authRoutes from './routes/auth.routes.js'
import publicRoutes from './routes/public.routes.js'
import contentRoutes from './routes/content.routes.js'
import adminRoutes from './routes/admin.routes.js'
import { errorHandler, notFound } from './middleware/error.js'

export function createApp() {
  const app = express()
  app.set('trust proxy', 1)
  app.use(helmet())
  app.use(cors({ origin: (process.env.CLIENT_URL || 'http://localhost:5173').split(','), credentials: false }))
  app.use(express.json({ limit: '50kb' }))
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'))
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 200, standardHeaders: 'draft-8', legacyHeaders: false }))
  app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 }), authRoutes)
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'garbhika-api' }))
  app.use('/api', publicRoutes)
  app.use('/api', contentRoutes)
  app.use('/api/admin', adminRoutes)
  app.use(notFound)
  app.use(errorHandler)
  return app
}
