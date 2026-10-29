import { credentialBlock } from './credentials.js'

// Shared by the expert setup panel and customer directory. Approval alone does
// not promise a free slot: the slot API still checks notice, conflicts and limits.
export function bookingReadiness(profile, user, services = [], availability, now = Date.now()) {
  const approved = profile?.verification?.status === 'approved'
  const credentials = approved && !credentialBlock(profile, now)
  const active = user?.status === 'active'
  const service = services.some(s => s.active && s.title?.trim() &&
    s.durationMin >= 15 && s.durationMin <= 120 && s.priceInr >= 500 && s.priceInr <= 3000)
  const schedule = !!availability && ((availability.weekly || []).some(b => b.start < b.end) ||
    (availability.overrides || []).some(b => !b.closed && b.date >= new Date(now + 330 * 60000).toISOString().slice(0, 10) && b.start < b.end))
  const modes = { instant: availability?.allowInstant === true, request: availability?.allowRequests === true }
  const checks = [
    { key: 'approval', label: 'Admin approval', done: approved, action: 'profile' },
    { key: 'account', label: 'Active expert account', done: active, action: 'refresh' },
    { key: 'credentials', label: 'Valid verified credentials', done: credentials, action: 'profile' },
    { key: 'service', label: 'At least one active service with a price and duration', done: service, action: 'services' },
    { key: 'schedule', label: 'Weekly availability or a future open day', done: schedule, action: 'calendar' },
    { key: 'modes', label: 'Instant bookings or time requests enabled', done: modes.instant || modes.request, action: 'calendar' },
    { key: 'accepting', label: 'Accepting bookings switched on', done: profile?.accepting === true, action: 'services' },
  ]
  return { approved, status: profile?.verification?.status || 'draft', listed: checks.every(c => c.done), modes, checks }
}
