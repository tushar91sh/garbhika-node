import bcrypt from 'bcryptjs'
import { createHash } from 'node:crypto'
import User from '../models/User.js'
import { assert, passwordOk, validEmail } from '../utils/validation.js'
export async function provisionAdmin() {
  const username = (process.env.ADMIN_USERNAME || '').trim().toLowerCase()
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase()
  const raw = process.env.ADMIN_PASSWORD || ''
  const configuredHash = process.env.ADMIN_PASSWORD_HASH || ''
  assert(
    username && validEmail(email),
    'Set ADMIN_USERNAME and a valid ADMIN_EMAIL in the backend environment.',
  )
  assert(
    configuredHash
      ? /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(configuredHash)
      : passwordOk(raw),
    'Set ADMIN_PASSWORD (8-72 bytes) or a valid bcrypt ADMIN_PASSWORD_HASH.',
  )
  const fingerprint = createHash('sha256')
    .update(username + ':' + email + ':' + (configuredHash || raw))
    .digest('hex')
  const existing = await User.findOne({ email }).select(
    '+adminCredentialFingerprint',
  )
  assert(
    !existing || existing.envManagedAdmin,
    'ADMIN_EMAIL belongs to a customer or legacy account. Use a dedicated admin email; no customer will be promoted.',
  )
  const passwordHash = configuredHash || (await bcrypt.hash(raw, 12))
  await User.updateMany(
    { envManagedAdmin: true, email: { $ne: email } },
    {
      $inc: { tokenVersion: 1 },
      $set: { envManagedAdmin: false, role: 'user', adminUsername: null },
    },
  )
  if (!existing)
    await User.create({
      name: 'Garbhika Admin',
      email,
      passwordHash,
      role: 'admin',
      adminUsername: username,
      envManagedAdmin: true,
      emailVerified: true,
      verificationMethod: 'admin',
      adminCredentialFingerprint: fingerprint,
    })
  else if (
    existing.adminCredentialFingerprint !== fingerprint ||
    existing.role !== 'admin'
  ) {
    existing.set({
      passwordHash,
      role: 'admin',
      adminUsername: username,
      emailVerified: true,
      verificationMethod: 'admin',
      adminCredentialFingerprint: fingerprint,
      tokenVersion: (existing.tokenVersion || 0) + 1,
    })
    await existing.save()
  }
}
