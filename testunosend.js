// Usage: node test-unosend.js you@example.com
require('dotenv').config();
const to = process.argv[2];
if (!to) { console.log('Usage: node test-unosend.js email@example.com'); process.exit(1); }
const url = process.env.UNOSEND_API_URL || 'https://www.unosend.co/api/v1/emails';
console.log('URL:', url, '| From:', process.env.UNOSEND_FROM, '| Key set:', !!process.env.UNOSEND_API_KEY);
fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.UNOSEND_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ from: process.env.UNOSEND_FROM, to: [to], subject: 'FinAssist test', html: '<p>It works!</p>', text: 'It works!' }),
}).then(async (r) => console.log('Status:', r.status, await r.text()))
  .catch((e) => console.log('FAILED:', e.message));