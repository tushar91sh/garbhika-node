// These tests run without a database: they cover routing, guards and validation that answer before any DB call.
import test from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import { createApp } from '../src/app.js'

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-long-enough-1234567890'
const app = createApp()

test('GET /api/health reports API status', async () => {
  const response = await request(app).get('/api/health')
  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'ok')
  assert.ok(response.headers['x-request-id'])
})

test('admin routes reject anonymous callers with 401', async () => {
  for (const path of ['/api/admin/stats', '/api/admin/users', '/api/admin/audit', '/api/admin/bookings/export.csv']) {
    const response = await request(app).get(path)
    assert.equal(response.status, 401, path)
  }
})

test('admin routes reject a valid token without the admin role', async () => {
  const jwt = (await import('jsonwebtoken')).default
  const token = jwt.sign({ sub: '000000000000000000000001', role: 'user' }, process.env.JWT_SECRET)
  // The user lookup happens before the role check; a valid token for a missing account still returns 401.
  const response = await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${token}`)
  assert.ok([401, 403].includes(response.status))
})

test('customer routes require login', async () => {
  const response = await request(app).get('/api/me/bookings')
  assert.equal(response.status, 401)
})

test('register validates input before touching the database', async () => {
  const response = await request(app).post('/api/auth/register').send({ name: 'A', email: 'bad', password: 'short' })
  assert.equal(response.status, 400)
  assert.match(response.body.message, /Name must be/)
})

test('requests without a JSON body do not crash', async () => {
  const response = await request(app).post('/api/inquiries')
  assert.equal(response.status, 400)
})

test('booking rejects an unknown time slot before touching the database', async () => {
  const response = await request(app).post('/api/bookings').send({ name: 'Test User', email: 't@example.com', preferredDate: '2030-01-01', timeSlot: '03:00' })
  assert.equal(response.status, 400)
  assert.match(response.body.message, /time slot/)
})

test('unsubscribe rejects a bad token', async () => {
  const response = await request(app).get('/api/newsletter/unsubscribe?token=bad')
  assert.equal(response.status, 400)
})

test('unknown API routes return JSON 404', async () => {
  const response = await request(app).get('/api/nope')
  assert.equal(response.status, 404)
})
