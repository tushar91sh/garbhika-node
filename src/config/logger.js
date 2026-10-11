// Minimal structured logger. Prints JSON lines in production so log tools can parse them.
const json = process.env.NODE_ENV === 'production'

function write(level, message, meta = {}) {
  if (json) {
    console.log(JSON.stringify({ time: new Date().toISOString(), level, message, ...meta }))
  } else {
    console.log(`[${level}] ${message}`, Object.keys(meta).length ? meta : '')
  }
}

export const logger = {
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
}
