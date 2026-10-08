export function notFound(req, res) {
  res.status(404).json({ message: `API route not found: ${req.method} ${req.originalUrl}` })
}

export function errorHandler(error, _req, res, _next) {
  if (error?.code === 11000) return res.status(409).json({ message: 'This record already exists.' })
  if (error?.name === 'ValidationError') {
    const details = Object.values(error.errors).map((item) => item.message)
    return res.status(400).json({ message: 'Validation failed.', details })
  }
  const status = error.status || 500
  res.status(status).json({ message: status === 500 ? 'Internal server error.' : error.message })
}
