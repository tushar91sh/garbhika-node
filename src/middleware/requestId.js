import { randomUUID } from 'node:crypto'

// Gives every request an id so a log line can be matched to an error report.
export function requestId(req, res, next) {
  req.id = req.headers['x-request-id'] && String(req.headers['x-request-id']).length <= 100 ? String(req.headers['x-request-id']) : randomUUID()
  res.setHeader('X-Request-Id', req.id)
  next()
}

// Express 5 leaves req.body undefined when a request has no JSON body; default it so handlers can read fields safely.
export function ensureBody(req, _res, next) {
  req.body ??= {}
  next()
}
