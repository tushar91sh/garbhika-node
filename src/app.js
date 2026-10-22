import onboardingRoutes from './care/onboarding.js'
import featureV2Routes from './care/feature-v2.js'
import express from 'express'
import careRoutes from './care/routes.js'
import enhancementRoutes from './care/enhancements.js'
import googleRoutes from './care/google.js'
import channelRoutes from './care/channels.js'
import receiptRoutes from './care/receipts.js'
import groupRoutes from './care/groups.js'
import documentRoutes from './care/documents.js'
import { paymentWebhook } from './care/payments.js'
import { videoWebhook } from './care/video.js'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import authRoutes from './routes/auth.routes.js'
import publicRoutes from './routes/public.routes.js'
import contentRoutes from './routes/content.routes.js'
import customerRoutes from './routes/customer.routes.js'
import adminRoutes from './routes/admin.routes.js'
import { errorHandler, notFound } from './middleware/error.js'
import { ensureBody, requestId } from './middleware/requestId.js'

morgan.token('id', (req) => req.id)

export function createApp() {
  const app = express()
  app.set('trust proxy', 1)
  const origins = (process.env.CLIENT_URL || 'http://localhost:5173').split(',').map((o) => o.trim()).filter(Boolean)
  app.use(requestId)
  app.use(helmet())
  app.use(cors({ origin: origins, credentials: true }))
  app.post('/api/webhooks/razorpay',express.raw({type:'application/json',limit:'1mb'}),paymentWebhook)
  app.post('/api/webhooks/video',express.raw({type:'application/json',limit:'1mb'}),videoWebhook)
  app.use(express.json({ limit: '15mb' }))
  app.use(ensureBody)
  app.use(morgan(process.env.NODE_ENV === 'production' ? ':id :remote-addr :method :url :status :res[content-length] - :response-time ms' : 'dev'))
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 900, standardHeaders: 'draft-8', legacyHeaders: false }))
  app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 }), authRoutes)
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'garbhika-api' }))
  app.use('/api',documentRoutes)
  app.use('/api',groupRoutes)
  app.use('/api',receiptRoutes)
  app.use('/api',channelRoutes)
  app.use('/api',googleRoutes)
  app.use('/api', onboardingRoutes)
  app.use('/api', featureV2Routes)
  app.use('/api', enhancementRoutes)
  app.use('/api/bookings', rateLimit({windowMs:15*60*1000,limit:90}))
  app.use('/api', careRoutes)
  app.use('/api', publicRoutes)
  app.use('/api', contentRoutes)
  app.use('/api/me', customerRoutes)
  app.use('/api/admin', adminRoutes)
  app.use(notFound)
  app.use(errorHandler)
  return app
}
