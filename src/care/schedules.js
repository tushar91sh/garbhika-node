import {DAY,istDate,validDate} from './policy.js'
const fail=message=>{throw Object.assign(new Error(message),{status:400})}
export function normalizeSchedule(input,prior={}){
 const frequency=input.frequency??prior.frequency??'daily'
 let schedule=input.schedule??prior.schedule
 if(frequency==='custom'){
  if(!schedule||!['times_per_week','weekdays'].includes(schedule.mode))fail('Choose a weekly count or specific weekdays.')
  if(schedule.mode==='times_per_week'){
   if(!Number.isInteger(schedule.count)||schedule.count<1||schedule.count>7)fail('Weekly count must be 1–7.')
   schedule={mode:'times_per_week',count:schedule.count,weekdays:[]}
  }else{
   if(!Array.isArray(schedule.weekdays)||!schedule.weekdays.length||schedule.weekdays.length>7||schedule.weekdays.some(d=>!Number.isInteger(d)||d<0||d>6)||new Set(schedule.weekdays).size!==schedule.weekdays.length)fail('Select unique weekdays from Sunday (0) to Saturday (6).')
   schedule={mode:'weekdays',weekdays:[...schedule.weekdays].sort(),count:schedule.weekdays.length}
  }
 }else{
  if(!['daily','weekly','3x week','as needed'].includes(frequency))fail('Invalid task frequency.')
  schedule=frequency==='daily'?{mode:'weekdays',weekdays:[0,1,2,3,4,5,6],count:7}:frequency==='as needed'?{mode:'as_needed',weekdays:[],count:0}:{mode:'times_per_week',weekdays:[],count:frequency==='weekly'?1:3}
 }
 return {frequency,schedule}
}
export function activeOn(task,date){return (!task.startAt||date>=istDate(task.startAt))&&(!task.endAt||date<=istDate(task.endAt))}
export function scheduledOn(task,date){if(!activeOn(task,date))return false;const {schedule}=normalizeSchedule({},task);return schedule.mode!=='weekdays'||schedule.weekdays.includes(new Date(date+'T12:00:00Z').getUTCDay())}
export function scheduleLabel(task){const {schedule}=normalizeSchedule({},task);return schedule.mode==='as_needed'?'As needed':schedule.mode==='times_per_week'?schedule.count+' times per week':schedule.weekdays.length===7?'Daily':schedule.weekdays.map(d=>['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ')}
export function weeklyAdherence(tasks,checks,now=new Date()){
 const today=istDate(now),local=new Date(today+'T00:00:00Z'),monday=new Date(+local-((local.getUTCDay()+6)%7)*DAY).toISOString().slice(0,10)
 let expected=0,completed=0
 const details=[]
 for(const t of tasks){const {schedule}=normalizeSchedule({},t);if(schedule.mode==='as_needed')continue
  let available=0
  for(let at=Date.parse(monday);at<=Date.parse(today);at+=DAY){const d=new Date(at).toISOString().slice(0,10);if(scheduledOn(t,d))available++}
  const target=schedule.mode==='weekdays'?available:Math.min(schedule.count,available)
  const dates=new Set(checks.filter(c=>String(c.task)===String(t._id)&&c.date>=monday&&c.date<=today&&scheduledOn(t,c.date)).map(c=>c.date))
  const done=Math.min(target,dates.size);expected+=target;completed+=done;details.push({task:t._id,expected:target,completed:done})
 }
 return {from:monday,to:today,expected,completed,percent:expected?Math.round(completed/expected*100):0}
}
export function scheduleDates(input,prior={}){
 const startAt=input.startAt===undefined?prior.startAt:input.startAt,endAt=input.endAt===undefined?prior.endAt:input.endAt
 for(const date of [startAt,endAt])if(date!==undefined&&date!==null&&date!==''&&!Number.isFinite(+new Date(date)))fail('Enter valid start/end dates.')
 if(startAt&&endAt&&+new Date(endAt)<+new Date(startAt))fail('End date cannot precede start date.')
 return {startAt:startAt||new Date(),endAt:endAt||null}
}
