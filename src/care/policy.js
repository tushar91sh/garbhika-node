export const DAY=86400000,HOUR=3600000,MIN=60000
export const istDate = (at=new Date()) => new Date(+new Date(at)+330*MIN).toISOString().slice(0,10)
export const isMother=u=>['user','mother'].includes(u?.role)
export const isAdmin=u=>['admin','superadmin'].includes(u?.role)
export const activeStates=['held','confirmed','in_progress','completed']
export const services=['garbh','yoga','nutrition','psych','mental','guidance','lactation']
export const plans={sanctuary:{name:'Sanctuary',price:0,credits:0},village:{name:'Village',price:1499,credits:4},premium:{name:'Premium Circle',price:3999,credits:10}}
export const redFlags=['Bleeding','Reduced baby movement','Severe headache','Blurred vision','Fluid leak']
export function canSeeHealth({actor,mother,hasBooking,shared=true}) {return String(actor.id)===String(mother.user)||actor.role==='expert'&&hasBooking&&mother.consents?.shareMedical===true&&shared}
export function cancellationPolicy(booking,by,now=Date.now()) {
  if (by==='expert') return {fraction:1,goodwill:200}
  if (['requested','proposed','held'].includes(booking.status)) return {fraction:1,goodwill:0}
  return {fraction:+new Date(booking.startAt)-now>=12*HOUR?1:0.5,goodwill:0}
}
export function payoutFor(booking,commission=20) {
  const gross=booking.payment?.kind==='credit'?(booking.durationMin>=45?950:600):booking.payment?.amount||0
  const fee=booking.payment?.kind==='credit'?0:Math.round(gross*commission)/100
  return {gross,fee,net:Math.round((gross-fee)*100)/100}
}
export function pregnancy(profile,now=Date.now()) {
 if(profile.stage==='postpartum') return {stage:'postpartum',week:profile.babyDob?Math.max(0,Math.floor((now-+new Date(profile.babyDob))/(7*DAY))):null}
 const due=profile.dueDate || (profile.lmpDate?new Date(+new Date(profile.lmpDate)+280*DAY):null)
 if(!due)return {stage:profile.stage,week:null}
 const days=Math.ceil((+new Date(due)-now)/DAY),week=Math.max(0,Math.min(42,40-Math.ceil(days/7)))
 return {stage:'pregnant',week,trimester:week<14?1:week<28?2:3,daysToGo:Math.max(0,days),babySize:week<8?'a small seed':week<13?'a lime':week<18?'an avocado':week<23?'a mango':week<28?'a cauliflower':week<33?'a pineapple':week<37?'a melon':'a watermelon',progress:Math.min(100,week/40*100)}
}
export function validDate(value) {return typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(+new Date(value)) && new Date(value).toISOString().slice(0,10)===value}
