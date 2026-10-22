import mongoose from 'mongoose'
const { Schema } = mongoose
const oid = (ref, required = false) => ({ type: Schema.Types.ObjectId, ref, required })
const mixed = Schema.Types.Mixed
function model(name, fields, indexes = []) {
  const schema = new Schema(fields, { timestamps: true })
  for (const [keys, options] of indexes) schema.index(keys, options)
  return mongoose.models[name] || mongoose.model(name, schema)
}
export const Mother = model('MotherProfile', {
  user: { ...oid('User', true), unique: true }, stage: { type: String, enum: ['ttc','pregnant','postpartum'], default: 'ttc' },
  dueDate: Date, lmpDate: Date, babyDob: Date, firstPregnancy: Boolean, coach: oid('User'), language: { type: String, default: 'English' },
  interests: [String], medicalCipher: { type: String, select: false }, plan: { type: String, default: 'sanctuary' },
  credits: { type: Number, default: 0, min: 0 }, goodwillInr: { type: Number, default: 0 }, renewsAt: Date,
  consents: { terms: Boolean, privacy: Boolean, shareMedical: { type: Boolean, default: false }, whatsapp: { type: Boolean, default: false } },
  consentHistory: [mixed], channels: { email: { type: Boolean, default: true }, inapp: { type: Boolean, default: true }, whatsapp: Boolean, push: Boolean },
  notificationPhone:String,
  bookmarks: [String], groups: [String], deletionAt: Date, welcomeUsedAt: Date,
})
export const Expert = model('ExpertProfile', {
  user: { ...oid('User', true), unique: true }, headline: String, bio: String, city: String, languages: [String], yearsExp: Number,
  googleCipher: {type:String,select:false}, safetyOnCall: {type:Boolean,default:false},
  registration: String, photoUrl: String, verification: { status: { type: String, default: 'pending' }, checks: { type: [Boolean], default: () => [false,false,false,false,false] }, reason: String, documents: [mixed], expiresAt: Date, documentPolicyVersion:Number, autoPaused:Boolean, submittedAt:Date },
  accepting: { type: Boolean, default: false }, commissionPct: { type: Number, default: 20 }, isCoach: { type: Boolean, default: false },
  rating: { type: Number, default: 0 }, reviewCount: { type: Number, default: 0 }, bank: { accountName: String, accountLast4: String, ifsc: String, razorpayContactId: String }, lockVersion: { type: Number, default: 0 },
})
export const Service = model('Service', { expert: oid('User', true), type: { type: String, enum: ['garbh','yoga','nutrition','psych','mental','guidance','lactation'], required: true }, title: String, durationMin: { type: Number, min: 15, max: 120 }, priceInr: { type: Number, min: 500, max: 3000 }, active: { type: Boolean, default: true } })
export const Availability = model('Availability', { expert: { ...oid('User',true), unique: true }, weekly: { type: [mixed], default: () => [1,2,3,4,5].map(dow => ({dow,start:'09:00',end:'17:00'})) }, overrides: [mixed], bufferMin: { type: Number, default: 15 }, minNoticeH: { type: Number, default: 12 }, windowDays: { type: Number, default: 28 }, maxPerDay: { type: Number, default: 8 }, allowInstant: { type: Boolean, default: true }, allowRequests: { type: Boolean, default: true } })
export const Note = model('SessionNote', { booking: { ...oid('Booking',true), unique: true }, expert: oid('User',true), mother: oid('User',true), summary: String, recommendations: [String], privateCipher: { type: String, select:false }, medicalFlag: Boolean, status: { type: String, enum: ['draft','published'], default:'draft' }, publishedAt: Date, versions: [mixed] })
export const Task = model('CarePlanTask', { mother: oid('User',true), expert: oid('User',true), title: String, category: { type:String,enum:['Nutrition','Movement','Mind'] }, frequency: { type:String,enum:['daily','weekly','as needed','3x week','custom'],default:'daily' }, schedule:{mode:String,count:Number,weekdays:[Number]}, startAt: Date, endAt: Date, templateId: oid('CareTemplate') })
export const TaskCheck = model('TaskCheck', { task: oid('CarePlanTask',true), mother:oid('User',true), date:String }, [[{task:1,date:1},{unique:true}]])
export const Journal = model('JournalEntry', { mother:oid('User',true), date:String, mood:{type:Number,min:1,max:5},symptoms:[String],noteCipher:{type:String,select:false},shared:Boolean,redFlag:Boolean,acknowledgedAt:Date }, [[{mother:1,date:1},{unique:true}]])
export const Thread = model('Thread', { mother:oid('User',true),expert:oid('User',true),closesAt:Date }, [[{mother:1,expert:1},{unique:true}]])
export const Message = model('Message', { thread:oid('Thread',true),sender:oid('User',true),bodyCipher:{type:String,select:false},readAt:Date,attachments:[mixed],reported:Boolean }, [[{thread:1,createdAt:1},{}]])
export const Group = model('GroupSession', { host:oid('User',true),title:String,startAt:Date,durationMin:Number,capacity:{type:Number,min:1,max:500},priceInr:{type:Number,min:0},audience:String,status:{type:String,enum:['review','live','rejected','done'],default:'review'},registrations:[{mother:oid('User'),paid:Boolean}],lockVersion:{type:Number,default:0} })
export const Review = model('Review', { booking:{...oid('Booking',true),unique:true},mother:oid('User',true),expert:oid('User',true),stars:{type:Number,min:1,max:5},text:String,reply:String,status:{type:String,default:'visible'},reportReason:String })
export const Subscription = model('Subscription', { mother:oid('User',true),plan:String,providerId:String,status:String,currentPeriodEnd:Date,pendingPlan:String,paymentId:String,renewalFailures:{type:Number,default:0} })
export const Payout = model('Payout', { expert:oid('User',true),bookings:[oid('Booking')],groupRegistrations:[oid('GroupRegistration')],gross:Number,fee:Number,tds:Number,net:Number,status:{type:String,default:'pending'},utr:String,periodStart:Date,periodEnd:Date })
export const Notification = model('Notification', { user:oid('User',true),type:String,title:String,body:String,payload:mixed,readAt:Date,dedupe:String }, [[{dedupe:1},{unique:true,sparse:true}]])
export const AccessLog = model('AccessLog', { actor:oid('User',true),mother:oid('User',true),resource:String })
export const Settings = model('CareSettings', { key:{type:String,unique:true},value:mixed })
export const CareTemplate = model('CareTemplate', { title:String,category:String,frequency:String,schedule:{mode:String,count:Number,weekdays:[Number]} })
export const Job = model('CareJob', { key:{type:String,unique:true},type:String,payload:mixed,dueAt:Date,lockedUntil:Date,attempts:{type:Number,default:0},doneAt:Date,lastError:String })
export const Refresh = model('RefreshSession', { hash:{type:String,unique:true},user:oid('User',true),version:Number,expiresAt:Date }, [[{expiresAt:1},{expireAfterSeconds:0}]])
export const WebhookEvent = model('WebhookEvent', { key:{type:String,unique:true},processedAt:Date })
export const Document = model('PrivateDocument', { owner:oid('User',true),name:String,mime:String,s3Key:{type:String,select:false},cipher:{type:Buffer,select:false},size:Number })

export const GroupRegistration = model('GroupRegistration', {group:oid('GroupSession',true),mother:oid('User',true),amount:Number,status:String,holdUntil:Date,orderId:String,paymentId:String,payoutId:oid('Payout')}, [[{group:1,mother:1},{unique:true}]])

export const PushSubscription = model('PushSubscription', {user:oid('User',true),endpoint:{type:String,unique:true},keys:{p256dh:String,auth:String}})

export const LiveNote = model('LiveNote', {booking:{...oid('Booking',true),unique:true},expert:oid('User',true),cipher:{type:String,select:false}})
export const RefundRequest = model('RefundRequest', {booking:{...oid('Booking',true),unique:true},mother:oid('User',true),reason:String,status:{type:String,enum:['pending','approved','denied'],default:'pending'},decisionReason:String,decidedBy:oid('User'),decidedAt:Date})

export const CommunityPost = model('CommunityPost', {author:oid('User',true),body:{type:String,required:true,maxlength:3000},status:{type:String,enum:['visible','removed'],default:'visible'},reports:[{user:oid('User'),reason:String}],moderationReason:String})
