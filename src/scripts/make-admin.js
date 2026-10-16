// Provision the dedicated administrator from backend environment settings.
import 'dotenv/config'
import mongoose from 'mongoose'
import { provisionAdmin } from '../services/admin.js'
try {
  await mongoose.connect(process.env.MONGODB_URI)
  await provisionAdmin()
  console.log('Environment administrator provisioned.')
} finally {
  await mongoose.disconnect()
}
