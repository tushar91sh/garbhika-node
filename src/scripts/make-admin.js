// Usage: node src/scripts/make-admin.js you@example.com
// Promotes an existing account to admin. The account must sign up first.
import 'dotenv/config'
import mongoose from 'mongoose'
import User from '../models/User.js'

const email = String(process.argv[2] || '').trim().toLowerCase()
if (!email) {
  console.error('Usage: node src/scripts/make-admin.js you@example.com')
  process.exit(1)
}
await mongoose.connect(process.env.MONGODB_URI)
const user = await User.findOneAndUpdate({ email }, { role: 'admin' }, { new: true })
console.log(user ? `${user.email} is now an admin.` : `No account found for ${email}. Sign up first.`)
await mongoose.disconnect()
