// Usage: node test-mail.js you@example.com   (sends a test email using .env settings)
require('dotenv').config();
const nodemailer = require('nodemailer');
const to = process.argv[2] || process.env.SMTP_USER;
const pass = (process.env.SMTP_PASS || '').replace(/\s+/g, '');
const port = Number(process.env.SMTP_PORT || 465);
console.log('Host:', process.env.SMTP_HOST, '| Port:', port, '| User:', process.env.SMTP_USER, '| Pass length:', pass.length, '(Gmail app password = 16)');
const t = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, auth: { user: process.env.SMTP_USER, pass }, family: 4, connectionTimeout: 15000, logger: false });
t.verify()
  .then(() => { console.log('1) Login OK'); return t.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject: 'AIPFA test email', text: 'It works!' }); })
  .then((i) => console.log('2) Sent to', i.accepted, '- check inbox AND spam'))
  .catch((e) => { console.error('FAILED:', e.code || '', e.message);
    if (e.code === 'EAUTH') console.error('-> Wrong user/password. Use a Gmail APP PASSWORD (needs 2-Step Verification ON).');
    if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET'].includes(e.code)) console.error('-> Network/port blocked. Try SMTP_PORT=587, another network/mobile hotspot, or turn off VPN/antivirus mail shield.'); });