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
