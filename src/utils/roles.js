export function adminEmails() {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
}

export function isAdminEmail(email) {
  return adminEmails().includes(String(email || '').toLowerCase())
}
