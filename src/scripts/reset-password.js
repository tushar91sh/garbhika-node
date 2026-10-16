// Usage: node src/scripts/reset-password.js you@example.com "NewStrongPassword"
// Sets a new password for any account, including the admin. Run it on the server, never from the browser.
import 'dotenv/config'
import mongoose from 'mongoose'
import User from '../models/User.js'

const [email, password] = [
  String(process.argv[2] || '')
    .trim()
    .toLowerCase(),
  process.argv[3] || '',
]
if (!email || password.length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
  console.error(
    'Usage: node src/scripts/reset-password.js you@example.com "password (8-72 characters)"',
  )
  process.exit(1)
}
await mongoose.connect(process.env.MONGODB_URI)
const user = await User.findOne({ email })
if (user?.envManagedAdmin) {
  console.log(
    'Change ADMIN_PASSWORD or ADMIN_PASSWORD_HASH in the environment and restart the backend.',
  )
} else if (!user) {
  console.log(`No account found for ${email}.`)
} else {
  user.passwordHash = await User.hashPassword(password)
  user.resetTokenHash = null
  user.resetTokenExpires = null
  user.tokenVersion = (user.tokenVersion || 0) + 1
  await user.save()
  console.log(`Password updated for ${email}.`)
}
await mongoose.disconnect()
