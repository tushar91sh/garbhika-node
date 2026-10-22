const emailPattern =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/

export function clean(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function validEmail(value) {
  const email = clean(value).toLowerCase(),
    [local = '', domain = ''] = email.split('@')
  return (
    emailPattern.test(email) &&
    email.length <= 254 &&
    local.length <= 64 &&
    !local.startsWith('.') &&
    !local.endsWith('.') &&
    !local.includes('..') &&
    domain.split('.').every((label) => label.length <= 63)
  )
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
  return (
    typeof value === 'string' &&
    value.length >= 8 &&
    Buffer.byteLength(value, 'utf8') <= 72
  )
}

export function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function safeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    interfaceLanguage:user.interfaceLanguage||'en',
    status: user.status || 'active',
    createdAt: user.createdAt,
    emailVerified: user.emailVerified,
    profile: user.profile,
    marketingOptIn: user.marketingOptIn,
  }
}

// Calendar day in YYYY-MM-DD form, used to enforce one booking per expert per slot.
export function dayKey(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 10)
}
