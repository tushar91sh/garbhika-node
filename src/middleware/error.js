import { logger } from '../config/logger.js'

export function notFound(req, res) {
  res.status(404).json({ message: `API route not found: ${req.method} ${req.originalUrl}` })
}

export function errorHandler(error, req, res, _next) {
  if (error?.code === 11000) return res.status(409).json({ message: error.userMessage || 'This record already exists.' })
  if (error?.name === 'CastError') return res.status(400).json({ message: 'Invalid identifier.' })
  if (error?.name === 'ValidationError') {
    const details = Object.values(error.errors).map((item) => item.message)
    return res.status(400).json({ message: 'Validation failed.', details })
  }
  const status = error.status || 500
  if (status >= 500) logger.error('Unhandled error', { requestId: req.id, path: req.originalUrl, error: error.message, stack: error.stack })
  res.status(status).json({ message: status === 500 ? 'Internal server error.' : error.message, requestId: req.id })
}
