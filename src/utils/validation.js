const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function validEmail(value) {
  return emailPattern.test(clean(value).toLowerCase())
}

export function assert(condition, message, status = 400) {
  if (!condition) {
    const error = new Error(message)
    error.status = status
    throw error
  }
}

export function safeUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role }
}
