import nodemailer from 'nodemailer'
import { logger } from '../config/logger.js'

let client
function transporter() {
  if (client !== undefined) return client
  client = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      })
    : null
  return client
}

export function clientUrl() {
  return (process.env.CLIENT_URL || 'http://localhost:5173').split(',')[0].trim().replace(/\/$/, '')
}

// Sends one email. Returns false when SMTP is not configured, so the caller can continue safely.
export async function sendMail({ to, subject, text }) {
  const smtp = transporter()
  if (!smtp) {
    logger.warn('Email skipped: SMTP is not configured', { subject })
    return false
  }
  await smtp.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text })
  return true
}

export async function notifySubmission(subject, lines) {
  if (!process.env.NOTIFICATION_EMAIL) return false
  return sendMail({ to: process.env.NOTIFICATION_EMAIL, subject, text: lines.filter(Boolean).join('\n') })
}

// Failures are logged, never thrown, so a mail outage cannot break a booking or signup.
export function sendMailSafely(options) {
  sendMail(options).catch((error) => logger.error('Email send failed', { subject: options.subject, error: error.message }))
}
