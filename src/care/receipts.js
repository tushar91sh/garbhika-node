import { Router } from 'express'
import Booking from '../models/Booking.js'
import { requireAuth,requireRole } from '../middleware/auth.js'
import { assert } from '../utils/validation.js'
const router=Router()
const escape=s=>String(s).replace(/[^\x20-\x7e]/g,'?').replace(/[\\()]/g,'\\$&')
function pdf(lines) {
 const stream=lines.map((line,i)=>`BT /F1 ${i?11:20} Tf 50 ${790-i*28} Td (${escape(line)}) Tj ET`).join('\n')
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`]
 let output='%PDF-1.4\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(output));output+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`}
 const start=Buffer.byteLength(output);output+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(x=>String(x).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;return Buffer.from(output)
}
router.get('/me/receipts',requireAuth,requireRole('mother'),async(req,res)=>res.json({items:await Booking.find({mother:req.user.id,'payment.captured':true,'payment.kind':'paid'}).select('_id createdAt startAt expertName payment').sort({createdAt:-1})}))
router.get('/bookings/:id/receipt',requireAuth,requireRole('mother'),async(req,res)=>{
 const b=await Booking.findOne({_id:req.params.id,mother:req.user.id,'payment.captured':true,'payment.kind':'paid'}).populate('service');assert(b,'Paid booking not found.',404)
 const lines=['Garbhika - Payment Receipt','Receipt: RCPT-'+b.id,'Date: '+b.createdAt.toISOString().slice(0,10),'Paid by: '+req.user.name,'Email: '+req.user.email,'Service: '+(b.service?.title||'Consultation'),'Expert: '+b.expertName,'Amount received: INR '+b.payment.amount.toFixed(2),'Payment reference: '+b.payment.paymentId,'Status: '+(b.payment.refunded?'Refund initiated':'Captured'),'This receipt is not a GST tax invoice.']
 const buffer=pdf(lines);res.set('Cache-Control','no-store').json({name:'Garbhika-receipt-'+b.id+'.pdf',mime:'application/pdf',base64:buffer.toString('base64')})
})
export default router
