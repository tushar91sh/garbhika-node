import {DAY,istDate,validDate} from './policy.js'
export const credentialTypes=['identity','degree','registration','insurance','other']
export const requiredCredentials=['identity','degree','registration','insurance']
export function documentExpiry(document){
 if(document.expiresOn)return +new Date(document.expiresOn+'T23:59:59.999+05:30')
 return document.expiresAt?+new Date(document.expiresAt):null
}
export function credentialBlock(profile,now=Date.now()){
 const verification=profile?.verification||{},docs=verification.documents||[]
 if(verification.documentPolicyVersion===2){
  for(const kind of requiredCredentials){const verified=docs.filter(d=>d.kind===kind&&d.status==='verified');if(!verified.some(d=>documentExpiry(d)===null||documentExpiry(d)>=now))return kind+' document needs verification or renewal.'}
 }else if(verification.expiresAt&&+new Date(verification.expiresAt)<=now)return 'Credential expired.'
 return null
}
export function validateCredentialInput(input){
 if(!credentialTypes.includes(input.kind))throw Object.assign(new Error('Choose a document type.'),{status:400})
 if(input.expiresOn&&!validDate(input.expiresOn))throw Object.assign(new Error('Enter a valid expiry date.'),{status:400})
 if(['registration','insurance'].includes(input.kind)&&!validDate(input.expiresOn))throw Object.assign(new Error('Registration and insurance require an expiry date.'),{status:400})
 return {kind:input.kind,expiresOn:input.expiresOn||null}
}
export async function processCredentialReminders({now=Date.now(),Expert,User,alert}){
 const staff=await User.find({role:{$in:['admin','superadmin']},status:'active'}).select('_id')
 for(const e of await Expert.find({'verification.status':'approved'})){
  const docs=(e.verification.documents?.length?e.verification.documents:e.verification.expiresAt?[{documentId:'legacy',name:'Existing credential',kind:'legacy',status:'verified',expiresAt:e.verification.expiresAt}]:[])
  for(const d of docs){
   const expiry=documentExpiry(d);if(d.status!=='verified'||expiry===null)continue
   const days=Math.ceil((expiry-now)/DAY);if(days>30)continue
   // A verified replacement supersedes the old credential; do not remind on old versions.
   if(docs.some(other=>String(other.documentId)!==String(d.documentId)&&other.kind===d.kind&&other.status==='verified'&&(documentExpiry(other)===null||documentExpiry(other)>expiry)))continue
   const threshold=days<=0?'expired':days<=7?'7':'30',key=`credential-document:${e.id}:${d.documentId}:${expiry}:${threshold}`
   const title=days<=0?'Credential expired':'Credential renewal reminder',body=`${d.kind||d.name}: ${days<=0?'renew and submit for verification.':'expires on '+(d.expiresOn||istDate(expiry))+'.'}`
   await alert(e.user,'credential.'+(days<=0?'expired':'expiring'),title,body,{documentId:d.documentId,expertId:e.id,kind:d.kind},key)
   for(const a of staff)await alert(a.id,'credential.review',title,'Review the expert credential renewal.',{documentId:d.documentId,expertId:e.id,kind:d.kind},key+':'+a.id)
  }
  if(credentialBlock(e,now)&&e.accepting)await Expert.updateOne({_id:e.id},{$set:{accepting:false,'verification.autoPaused':true}})
 }
}
