import 'dotenv/config'
import mongoose from 'mongoose'
import User from '../src/models/User.js'
import Booking from '../src/models/Booking.js'
import * as models from '../src/care/models.js'
if(!process.env.MONGODB_URI)throw new Error('Set MONGODB_URI in backend/.env first.')
try{
 await mongoose.connect(process.env.MONGODB_URI)
 const result=await User.updateMany({role:'user'},{$set:{role:'mother'}})
 await User.updateMany({status:{$exists:false}},{$set:{status:'active'}})
 const conflicts=await Booking.aggregate([{$match:{status:{$in:['requested','held','confirmed','in_progress']}}},{$group:{_id:{expertKey:'$expertKey',dateKey:'$dateKey',timeSlot:'$timeSlot'},count:{$sum:1}}},{$match:{count:{$gt:1}}},{$limit:1}]);if(conflicts.length)throw new Error('Conflicting active slots exist. Resolve duplicate bookings before migration; no bookings were removed.')
 const old=(await Booking.collection.indexes()).find(i=>i.name==='expertKey_1_dateKey_1_timeSlot_1');if(old&&!old.partialFilterExpression?.status?.$in?.includes('held'))await Booking.collection.dropIndex(old.name)
 for(const model of [User,Booking,...Object.values(models)])if(typeof model?.createIndexes==='function')await model.createIndexes()
 console.log(`Migrated ${result.modifiedCount} customer roles to mother. Indexes created. No accounts or bookings were removed.`)
}finally{await mongoose.disconnect()}
