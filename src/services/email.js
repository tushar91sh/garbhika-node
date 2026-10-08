import nodemailer from 'nodemailer'

function transporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })
}

export async function notifySubmission(subject, lines) {
  const client = transporter()
  if (!client || !process.env.NOTIFICATION_EMAIL) return false
  await client.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.NOTIFICATION_EMAIL,
    subject,
    text: lines.filter(Boolean).join('\n'),
  })
  return true
}
