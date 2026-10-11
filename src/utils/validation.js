const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function validEmail(value) {
  return emailPattern.test(clean(value).toLowerCase()) && clean(value).length <= 254
}

export function assert(condition, message, status = 400) {
  if (!condition) {
    const error = new Error(message)
    error.status = status
    throw error
  }
}

// bcrypt only reads the first 72 bytes, so longer passwords are rejected instead of silently truncated.
export function passwordOk(value) {
  return typeof value === 'string' && value.length >= 8 && Buffer.byteLength(value, 'utf8') <= 72
}

export function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function safeUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt }
}

// Calendar day in YYYY-MM-DD form, used to enforce one booking per expert per slot.
export function dayKey(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}
