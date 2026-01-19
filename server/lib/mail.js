const nodemailer = require('nodemailer');

// Create a transport for sending emails. Supports SMTP URL in EMAIL_SMTP_URL or Gmail creds
function buildTransport() {
  if (process.env.EMAIL_SMTP_URL) {
    return nodemailer.createTransport(process.env.EMAIL_SMTP_URL);
  }
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
    });
  }
  // Fallback to json transport in dev so requests succeed
  return nodemailer.createTransport({ jsonTransport: true });
}

module.exports = {
  buildTransport
};
