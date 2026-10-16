import { before, beforeEach, after, test } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import mongoose from 'mongoose'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { createApp } from '../src/app.js'
import User from '../src/models/User.js'
import Booking from '../src/models/Booking.js'
import { provisionAdmin } from '../src/services/admin.js'
import { developmentBypass } from '../src/services/verification.js'
let db, app, customer, admin, code, resetToken
const realFetch = global.fetch
const signup = {
  name: 'Integration Customer',
  email: 'member@example.test',
  password: 'StrongPass123!',
  confirmPassword: 'StrongPass123!',
  acceptTerms: true,
  marketingOptIn: false,
}
before(
  async () => {
    process.env.NODE_ENV = 'development'
    process.env.OTP_DEV_BYPASS = 'true'
    process.env.JWT_SECRET = 'integration-secret-at-least-32-characters-long'
    process.env.ADMIN_USERNAME = 'owner'
    process.env.ADMIN_EMAIL = 'owner@example.test'
    process.env.ADMIN_PASSWORD = 'AdminPass123!'
    process.env.CLIENT_URL = 'http://localhost:5173'
    db = await MongoMemoryServer.create({
      binary: { version: '7.0.14' },
      instance: { args: ['--nounixsocket'] },
    })
    await mongoose.connect(db.getUri())
    await User.init()
    await Booking.init()
    await provisionAdmin()
    app = createApp()
    global.fetch = async (url, options) => {
      assert.equal(url, 'https://api.brevo.com/v3/smtp/email')
      const body = JSON.parse(options.body)
      code = body.textContent.match(/code is (\d{6})/)?.[1] || code
      resetToken =
        body.textContent.match(/token=([a-f0-9]{64})/)?.[1] || resetToken
      return { ok: true }
    }
  },
  { timeout: 180000 },
)
beforeEach(() => {
  app = createApp()
})
after(async () => {
  global.fetch = realFetch
  await mongoose.disconnect()
  await db?.stop()
})
test('development signup, profile, customer/admin separation and session revocation', async () => {
  let r = await request(app)
    .post('/api/auth/register')
    .send({ ...signup, role: 'admin' })
  assert.equal(r.status, 201)
  assert.equal(r.body.token, undefined)
  assert.equal(r.body.verificationRequired, true)
  assert.match(r.body.developmentCode, /^\d{6}$/)
  const pending = await User.findOne({ email: signup.email })
  assert.equal(pending.role, 'user')
  assert.equal(pending.emailVerified, false)
  const confirmed = await request(app)
    .post('/api/auth/verification/development-bypass')
    .send({ challenge: r.body.challenge })
  assert.equal(confirmed.status, 200)
  assert.equal(confirmed.body.user.emailVerified, true)
  customer = confirmed.body.token
  assert.equal(
    (await request(app).post('/api/auth/register').send(signup)).status,
    409,
  )
  assert.equal(
    (
      await request(app)
        .post('/api/auth/register')
        .send({ ...signup, email: process.env.ADMIN_EMAIL })
    ).status,
    409,
  )
  assert.equal(
    (
      await request(app)
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${customer}`)
    ).status,
    403,
  )
  r = await request(app)
    .patch('/api/me/journey')
    .set('Authorization', `Bearer ${customer}`)
    .send({
      stage: 'Pregnant',
      language: 'Hindi',
      services: ['Pregnancy yoga'],
      context: 'Prefer gentle guidance',
    })
  assert.equal(r.status, 200)
  assert.equal(r.body.user.profile.completed, true)
  assert.equal(
    (
      await request(app)
        .patch('/api/me/journey')
        .set('Authorization', `Bearer ${customer}`)
        .send({ stage: 'bad', language: 'Hindi', services: ['Pregnancy yoga'] })
    ).status,
    400,
  )
  r = await request(app)
    .post('/api/auth/admin/login')
    .send({ username: 'owner', password: 'AdminPass123!' })
  assert.equal(r.status, 200)
  admin = r.body.token
  r = await request(app)
    .get('/api/admin/users')
    .set('Authorization', `Bearer ${admin}`)
  assert.equal(r.status, 200)
  assert.equal(r.body.items.length, 1)
  assert.equal(r.body.items[0].profile.language, 'Hindi')
  assert.equal(r.body.items[0].passwordHash, undefined)
  assert.equal(r.body.items[0].otpHash, undefined)
  assert.equal(
    (
      await request(app)
        .post('/api/auth/login')
        .send({ email: process.env.ADMIN_EMAIL, password: 'AdminPass123!' })
    ).status,
    401,
  )
  assert.equal(
    (
      await request(app)
        .post('/api/auth/admin/login')
        .send({ username: signup.email, password: signup.password })
    ).status,
    401,
  )
  await request(app)
    .post('/api/auth/logout')
    .set('Authorization', `Bearer ${customer}`)
    .send({})
  assert.equal(
    (
      await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${customer}`)
    ).status,
    401,
  )
})
test('production has no bypass; OTP is required, purpose-bound, limited and single-use', async () => {
  process.env.NODE_ENV = 'production'
  process.env.OTP_DEV_BYPASS = 'true'
  process.env.BREVO_API_KEY = 'mock-only'
  process.env.BREVO_SENDER_EMAIL = 'sender@example.test'
  assert.equal(developmentBypass(), false)
  let r = await request(app)
    .post('/api/auth/register')
    .send({ ...signup, email: 'verified@example.test' })
  assert.equal(r.status, 201)
  assert.equal(r.body.token, undefined)
  assert.equal(r.body.verificationRequired, true)
  const challenge = r.body.challenge
  assert.equal(r.body.developmentCode, undefined)
  assert.equal(r.body.devBypassAvailable, false)
  assert.equal(
    (
      await request(app)
        .post('/api/auth/verification/development-bypass')
        .send({ challenge })
    ).status,
    404,
  )
  assert.match(code, /^\d{6}$/)
  assert.equal(
    (
      await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${challenge}`)
    ).status,
    401,
  )
  assert.equal(
    (
      await request(app)
        .post('/api/auth/verification/resend')
        .send({ challenge })
    ).status,
    429,
  )
  assert.equal(
    (
      await request(app)
        .post('/api/auth/verification/confirm')
        .send({ challenge, code: '000000' })
    ).status,
    400,
  )
  r = await request(app)
    .post('/api/auth/verification/confirm')
    .send({ challenge, code })
  assert.equal(r.status, 200)
  assert.ok(r.body.token)
  const token = r.body.token
  assert.equal(
    (
      await request(app)
        .post('/api/auth/verification/confirm')
        .send({ challenge, code })
    ).status,
    400,
  )
  assert.equal(
    (
      await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
    ).status,
    200,
  )
  r = await request(app).post('/api/auth/login').send(signup)
  assert.equal(
    r.body.verificationRequired,
    true,
    'dev-verified account must verify again in production',
  )
})
test('OTP expires, locks after five wrong attempts and successful resend invalidates old code', async () => {
  let r = await request(app)
    .post('/api/auth/register')
    .send({ ...signup, email: 'limits@example.test' })
  const challenge = r.body.challenge
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await request(app)
          .post('/api/auth/verification/confirm')
          .send({ challenge, code: '000000' })
      ).status,
      400,
    )
  assert.equal(
    (
      await request(app)
        .post('/api/auth/verification/confirm')
        .send({ challenge, code })
    ).status,
    400,
  )
  await User.updateOne(
    { email: 'limits@example.test' },
    { $set: { otpSentAt: new Date(Date.now() - 61000) } },
  )
  r = await request(app)
    .post('/api/auth/verification/resend')
    .send({ challenge })
  assert.equal(r.status, 200)
  await User.updateOne(
    { email: 'limits@example.test' },
    { $set: { otpExpires: new Date(Date.now() - 1000) } },
  )
  assert.equal(
    (
      await request(app)
        .post('/api/auth/verification/confirm')
        .send({ challenge, code })
    ).status,
    400,
  )
})
test('password reset is single-use and invalidates existing access tokens', async () => {
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'verified@example.test', password: signup.password })
  assert.ok(login.body.token)
  let r = await request(app)
    .post('/api/auth/forgot-password')
    .send({ email: 'verified@example.test' })
  assert.equal(r.status, 200)
  assert.ok(resetToken)
  r = await request(app)
    .post('/api/auth/reset-password')
    .send({ token: resetToken, password: 'UpdatedPass123!' })
  assert.equal(r.status, 200)
  assert.equal(
    (
      await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${login.body.token}`)
    ).status,
    401,
  )
  assert.equal(
    (
      await request(app)
        .post('/api/auth/reset-password')
        .send({ token: resetToken, password: 'OtherPass123!' })
    ).status,
    400,
  )
})
test('OTP delivery failures do not grant access; retry is available', async () => {
  global.fetch = async () => ({ ok: false })
  const r = await request(app)
    .post('/api/auth/register')
    .send({ ...signup, email: 'failure@example.test' })
  assert.equal(r.status, 201)
  assert.equal(r.body.deliveryFailed, true)
  assert.equal(r.body.token, undefined)
  global.fetch = async (url, options) => {
    code = JSON.parse(options.body).textContent.match(/code is (\d{6})/)?.[1]
    return { ok: true }
  }
  assert.equal(
    (
      await request(app)
        .post('/api/auth/verification/resend')
        .send({ challenge: r.body.challenge })
    ).status,
    200,
  )
})
test('changing customer passwords invalidates old sessions and admin rotation is environment-only', async () => {
  let r = await request(app)
    .post('/api/auth/login')
    .send({ email: 'verified@example.test', password: 'UpdatedPass123!' })
  const token = r.body.token
  assert.ok(token)
  r = await request(app)
    .post('/api/me/password')
    .set('Authorization', `Bearer ${token}`)
    .send({
      currentPassword: 'UpdatedPass123!',
      newPassword: 'FinalPassword123!',
    })
  assert.equal(r.status, 200)
  assert.equal(
    (
      await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
    ).status,
    401,
  )
  const old = await request(app)
    .post('/api/auth/admin/login')
    .send({ username: 'owner', password: 'AdminPass123!' })
  process.env.ADMIN_PASSWORD = 'RotatedAdmin123!'
  await provisionAdmin()
  assert.equal(
    (
      await request(app)
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${old.body.token}`)
    ).status,
    401,
  )
  assert.equal(
    (
      await request(app)
        .post('/api/auth/admin/login')
        .send({ username: 'owner', password: 'RotatedAdmin123!' })
    ).status,
    200,
  )
})
test('customer booking ownership and actual admin data tabs', async () => {
  const r = await request(app)
      .post('/api/auth/login')
      .send({ email: 'verified@example.test', password: 'FinalPassword123!' }),
    token = r.body.token
  assert.ok(token)
  const other = await User.findOne({ email: signup.email })
  const booking = await Booking.create({
    name: other.name,
    email: other.email,
    preferredDate: new Date('2030-01-01'),
    dateKey: '2030-01-01',
    timeSlot: '09:00',
    expertKey: 'general',
    user: other.id,
  })
  assert.equal(
    (
      await request(app)
        .patch(`/api/me/bookings/${booking.id}/cancel`)
        .set('Authorization', `Bearer ${token}`)
    ).status,
    404,
  )
  const mine = await request(app)
    .get('/api/me/bookings')
    .set('Authorization', `Bearer ${token}`)
  assert.equal(mine.body.bookings.length, 0)
  const a = await request(app)
    .post('/api/auth/admin/login')
    .send({ username: 'owner', password: 'RotatedAdmin123!' })
  for (const path of [
    'stats',
    'bookings',
    'inquiries',
    'users',
    'subscribers',
    'community',
    'audit',
  ])
    assert.equal(
      (
        await request(app)
          .get('/api/admin/' + path)
          .set('Authorization', `Bearer ${a.body.token}`)
      ).status,
      200,
      path,
    )
  assert.equal(
    (
      await request(app)
        .patch(`/api/admin/users/${other.id}/role`)
        .set('Authorization', `Bearer ${a.body.token}`)
        .send({ role: 'admin' })
    ).status,
    404,
  )
})

test('development signup stays pending until a test-code confirmation; bypass cannot be replayed', async () => {
  process.env.NODE_ENV = 'development'
  process.env.OTP_DEV_BYPASS = 'true'
  const pending = await request(app)
    .post('/api/auth/register')
    .send({ ...signup, email: 'dev-code@example.test' })
  assert.equal(pending.body.token, undefined)
  assert.match(pending.body.developmentCode, /^\d{6}$/)
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: 'dev-code@example.test', password: signup.password })
  assert.equal(login.body.token, undefined)
  assert.equal(login.body.verificationRequired, true)
  const done = await request(app)
    .post('/api/auth/verification/confirm')
    .send({
      challenge: pending.body.challenge,
      code: pending.body.developmentCode,
    })
  assert.equal(done.status, 200)
  assert.equal(done.body.user.emailVerified, true)
  assert.equal(
    (
      await request(app)
        .post('/api/auth/verification/development-bypass')
        .send({ challenge: pending.body.challenge })
    ).status,
    400,
  )
})
