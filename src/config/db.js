import mongoose from 'mongoose'

export async function connectDatabase(uri = process.env.MONGODB_URI) {
  if (!uri) throw new Error('MONGODB_URI is required')
  mongoose.set('strictQuery', true)
  await mongoose.connect(uri)
  return mongoose.connection
}

export async function disconnectDatabase() {
  await mongoose.disconnect()
}
