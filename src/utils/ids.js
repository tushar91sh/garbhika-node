import mongoose from 'mongoose'

export const isValidId = (value) => mongoose.isValidObjectId(value) && String(value).length === 24
