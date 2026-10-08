import test from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'
import { createApp } from '../src/app.js'

test('GET /api/health reports API status', async () => {
  const response = await request(createApp()).get('/api/health')
  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'ok')
})
