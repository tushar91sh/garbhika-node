import { uploadPrivate,downloadUrl } from './storage.js'
import net from 'node:net'
import { Router } from 'express'
import { Document,Expert,Message,Thread } from './models.js'
import { requireAuth } from '../middleware/auth.js'
import { assert,clean } from '../utils/validation.js'
import { encryptBuffer,decryptBuffer } from './security.js'
import { isAdmin } from './policy.js'
const router=Router()
async function scan(buffer) {
 if(!process.env.CLAMAV_HOST){assert(process.env.NODE_ENV!=='production','Configure CLAMAV_HOST before uploading documents in production.',503);return}
 await new Promise((resolve,reject)=>{
  const socket=net.connect(Number(process.env.CLAMAV_PORT||3310),process.env.CLAMAV_HOST),chunks=[]
  socket.setTimeout(15000,()=>socket.destroy(new Error('Virus scanner timed out.')))
  socket.on('error',reject);socket.on('data',d=>chunks.push(d));socket.on('end',()=>Buffer.concat(chunks).toString().includes('stream: OK')?resolve():reject(Object.assign(new Error('Attachment rejected by the virus scanner.'),{status:400})))
  socket.on('connect',()=>{socket.write('zINSTREAM\0');for(let i=0;i<buffer.length;i+=65536){const b=buffer.subarray(i,i+65536),n=Buffer.alloc(4);n.writeUInt32BE(b.length);socket.write(n);socket.write(b)}socket.write(Buffer.alloc(4))})
 })
}
router.post('/care/documents',requireAuth,async(req,res)=>{
 const b=req.body;assert(['application/pdf','image/jpeg','image/png'].includes(b.mime),'Only PDF, JPG and PNG are accepted.')
 assert(typeof b.base64==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(b.base64),'Invalid file encoding.')
 const buffer=Buffer.from(b.base64,'base64');assert(buffer.length>0&&buffer.length<=10*1024*1024,'File must be between 1 byte and 10 MB.')
 const valid=b.mime==='application/pdf'?buffer.subarray(0,5).toString()==='%PDF-':b.mime==='image/png'?buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):buffer[0]===255&&buffer[1]===216&&buffer[2]===255
 assert(valid,'The file content does not match its file type.');await scan(buffer)
 const s3Key=await uploadPrivate(buffer,b.mime)
 const document=await Document.create({owner:req.user.id,name:clean(b.name).replace(/[\\/\r\n]/g,'_').slice(0,150)||'attachment',mime:b.mime,...(s3Key?{s3Key}:{cipher:encryptBuffer(buffer)}),size:buffer.length})
 res.status(201).json({document:{_id:document.id,name:document.name,mime:document.mime,size:document.size}})
})
router.get('/care/documents/:id',requireAuth,async(req,res)=>{
 const document=await Document.findById(req.params.id).select('+cipher +s3Key');assert(document,'Document not found.',404)
 let allowed=String(document.owner)===req.user.id
 if(!allowed&&isAdmin(req.user))allowed=!!await Expert.exists({user:document.owner,'verification.documents.documentId':document.id})
 if(!allowed){const messages=await Message.find({'attachments.documentId':document.id}).distinct('thread');allowed=!!await Thread.exists({_id:{$in:messages},$or:[{mother:req.user.id},{expert:req.user.id}]})}
 assert(allowed,'Document not found.',404)
 if(document.s3Key)return res.set('Cache-Control','no-store').json({name:document.name,mime:document.mime,url:await downloadUrl(document.s3Key,document.name)})
 res.set('Cache-Control','no-store').json({name:document.name,mime:document.mime,base64:decryptBuffer(document.cipher).toString('base64')})
})
export default router
