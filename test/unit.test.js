import test from 'node:test'
import assert from 'node:assert/strict'
import { clean, dayKey, escapeRegex, passwordOk, validEmail } from '../src/utils/validation.js'
import { toCsv } from '../src/utils/csv.js'
import { createResetToken, sha256, unsubscribeToken, readUnsubscribeToken } from '../src/services/tokens.js'
import { isAdminEmail } from '../src/utils/roles.js'

test('validEmail accepts normal addresses and rejects junk', () => {
  assert.equal(validEmail('a@b.co'), true)
  assert.equal(validEmail('not-an-email'), false)
  assert.equal(validEmail(42), false)
})

test('passwordOk enforces 8 to 72 bytes', () => {
  assert.equal(passwordOk('short'), false)
  assert.equal(passwordOk('a'.repeat(8)), true)
  assert.equal(passwordOk('a'.repeat(73)), false)
  assert.equal(passwordOk(undefined), false)
})

test('dayKey normalises dates and rejects invalid ones', () => {
  assert.equal(dayKey('2030-05-01'), '2030-05-01')
  assert.equal(dayKey('nope'), null)
})

test('escapeRegex makes user search text literal', () => {
  assert.equal(escapeRegex('a.*b'), 'a\\.\\*b')
})

test('clean trims strings and ignores non-strings', () => {
  assert.equal(clean('  hi '), 'hi')
  assert.equal(clean({}), '')
})

test('toCsv quotes fields and blocks formula injection', () => {
  const csv = toCsv([{ name: '=HYPERLINK("x")', note: 'a, "b"' }], ['name', 'note'])
  assert.equal(csv, 'name,note\n"\'=HYPERLINK(""x"")","a, ""b"""')
})

test('reset tokens are random and only the hash is derivable', () => {
  const { token, hash, expires } = createResetToken()
  assert.equal(token.length, 64)
  assert.equal(sha256(token), hash)
  assert.ok(expires.getTime() > Date.now())
})

test('unsubscribe tokens round-trip and reject other purposes', async () => {
  process.env.JWT_SECRET = 'test-secret-that-is-long-enough-1234567890'
  const token = unsubscribeToken('reader@example.com')
  assert.equal(readUnsubscribeToken(token), 'reader@example.com')
  assert.throws(() => readUnsubscribeToken('garbage'))
})

test('isAdminEmail reads ADMIN_EMAILS case-insensitively', () => {
  process.env.ADMIN_EMAILS = ' Admin@Garbhika.com , other@x.com'
  assert.equal(isAdminEmail('admin@garbhika.com'), true)
  assert.equal(isAdminEmail('someone@else.com'), false)
})

test('email validation rejects malformed local parts and domain labels', () => {
  for (const email of ['.a@example.com', 'a..b@example.com', 'a@-example.com', 'a@example-.com', 'a b@example.com']) assert.equal(validEmail(email), false, email)
  assert.equal(validEmail('mother+care@example.co.in'), true)
})

test('verification bypass is restricted to explicit development mode', async () => {
  const { developmentBypass } = await import('../src/services/verification.js')
  const previous = { mode: process.env.NODE_ENV, bypass: process.env.OTP_DEV_BYPASS }
  try {
    for (const mode of ['production', 'test', 'staging', '']) { process.env.NODE_ENV = mode; process.env.OTP_DEV_BYPASS = 'true'; assert.equal(developmentBypass(), false) }
    process.env.NODE_ENV = 'development'; process.env.OTP_DEV_BYPASS = 'true'; assert.equal(developmentBypass(), true)
    process.env.OTP_DEV_BYPASS = 'false'; assert.equal(developmentBypass(), false)
  } finally {
    if(previous.mode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous.mode
    if(previous.bypass === undefined) delete process.env.OTP_DEV_BYPASS; else process.env.OTP_DEV_BYPASS = previous.bypass
  }
})

test('journey validation requires approved options and ignores removed fields', async () => {
  const { validateProfile } = await import('../src/utils/profile.js')
  assert.throws(() => validateProfile({stage:'Pregnant',language:'Hindi',services:[]}), /service/)
  assert.throws(() => validateProfile({stage:'Pregnant',language:'Hindi',services:['Pregnancy yoga'],dueDate:'2026-02-30'}), /valid due date/)
  const result = validateProfile({stage:'Exploring support',language:'Both',services:['Help me choose'],dueDate:'bad',expectations:'ignored',city:'ignored',context:'Hello'})
  assert.equal(result.dueDate, ''); assert.equal(result.expectations, undefined); assert.equal(result.city, undefined); assert.equal(result.completed, true)
})
