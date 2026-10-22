import { resolveUser } from '../middleware/auth.js'
import { Thread } from './models.js'
let io
export const emitUser=(user,event,data)=>io?.to('user:'+String(user)).emit(event,data)
export async function attachRealtime(server) {
 const {Server}=await import('socket.io')
 io=new Server(server,{cors:{origin:(process.env.CLIENT_URL||'http://localhost:5173').split(',').map(x=>x.trim()),credentials:true},maxHttpBufferSize:20000})
 io.use(async(socket,next)=>{try{const user=await resolveUser({headers:{authorization:'Bearer '+String(socket.handshake.auth?.token||'')}});if(!user||user.status==='pending')return next(new Error('Sign in with an active account.'));socket.data.user={id:user.id,role:user.role,version:user.tokenVersion||0};next()}catch{next(new Error('Session unavailable.'))}})
 io.on('connection',socket=>{
  const user=socket.data.user;socket.join('user:'+user.id)
  // Revalidate every client event so role/status/token revocation takes effect on open sockets.
  let lastTyping=0
  socket.on('typing',async payload=>{
   try{if(Date.now()-lastTyping<1200)return;lastTyping=Date.now();const current=await resolveUser({headers:{authorization:'Bearer '+String(socket.handshake.auth?.token||'')}});if(!current){socket.disconnect();return}
    const t=await Thread.findById(payload?.thread);if(!t||+t.closesAt<Date.now()||![String(t.mother),String(t.expert)].includes(user.id))return
    const recipient=String(t.mother)===user.id?t.expert:t.mother;emitUser(recipient,'typing',{thread:t.id,user:user.id,active:payload.active===true})
   }catch{/* Invalid thread events are ignored. */}
  })
 })
 return io
}
