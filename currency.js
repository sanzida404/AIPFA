'use strict';
// Live currency conversion for the AI assistant. Free sources, no API key.
// Rates are cached for 1 hour and the sources are tried in order.
const TTL = 60 * 60 * 1000;
let cache = { rates: null, at: 0, asOf: '', source: '' };

const SOURCES = [
  {
    name: 'open.er-api.com',
    url: 'https://open.er-api.com/v6/latest/USD',
    parse: (j) => (j && j.result === 'success' && j.rates ? { rates: j.rates, asOf: (j.time_last_update_utc || '').slice(0, 16) } : null),
  },
  {
    name: 'currency-api (jsDelivr)',
    url: 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    parse: (j) => {
      if (!j || !j.usd) return null;
      const rates = {};
      for (const [k, v] of Object.entries(j.usd)) if (/^[a-z]{3}$/.test(k) && Number(v) > 0) rates[k.toUpperCase()] = Number(v);
      return Object.keys(rates).length > 30 ? { rates, asOf: j.date || '' } : null;
    },
  },
  {
    name: 'frankfurter.app',
    url: 'https://api.frankfurter.app/latest?from=USD',
    parse: (j) => (j && j.rates ? { rates: { USD: 1, ...j.rates }, asOf: j.date || '' } : null),
  },
];

async function loadRates() {
  if (cache.rates && Date.now() - cache.at < TTL) return cache;
  for (const s of SOURCES) {
    try {
      const r = await fetch(s.url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) continue;
      const parsed = s.parse(await r.json());
      if (!parsed) continue;
      let iso = null;
      try { iso = new Set(Intl.supportedValuesOf('currency')); } catch { /* older Node: keep everything */ }
      const rates = {};
      for (const [k, v] of Object.entries(parsed.rates)) {
        if (Number(v) > 0 && /^[A-Z]{3}$/.test(k) && (!iso || iso.has(k))) rates[k] = Number(v);
      }
      rates.USD = 1;
      cache = { rates, at: Date.now(), asOf: parsed.asOf, source: s.name, names: null };
      return cache;
    } catch { /* try the next source */ }
  }
  if (cache.rates) return cache; // stale rates are better than none
  throw new Error('Live exchange rates are unavailable right now.');
}

// Common names, symbols and local words -> ISO code.
const ALIASES = {
  taka: 'BDT', tk: 'BDT', takas: 'BDT', '৳': 'BDT', bangladeshi: 'BDT', bangladesh: 'BDT',
  dollar: 'USD', dollars: 'USD', usd: 'USD', '$': 'USD', buck: 'USD', bucks: 'USD', american: 'USD',
  yuan: 'CNY', rmb: 'CNY', renminbi: 'CNY', chinese: 'CNY', china: 'CNY',
  euro: 'EUR', euros: 'EUR', '€': 'EUR',
  pound: 'GBP', pounds: 'GBP', sterling: 'GBP', '£': 'GBP', british: 'GBP',
  yen: 'JPY', '¥': 'JPY', japanese: 'JPY', japan: 'JPY',
  rupee: 'INR', rupees: 'INR', '₹': 'INR', indian: 'INR', india: 'INR',
  riyal: 'SAR', saudi: 'SAR', dirham: 'AED', emirati: 'AED', uae: 'AED',
  ringgit: 'MYR', malaysian: 'MYR', baht: 'THB', thai: 'THB', won: 'KRW', korean: 'KRW',
  rupiah: 'IDR', indonesian: 'IDR', ruble: 'RUB', rouble: 'RUB', russian: 'RUB',
  lira: 'TRY', turkish: 'TRY', franc: 'CHF', swiss: 'CHF', rand: 'ZAR',
  canadian: 'CAD', australian: 'AUD', aussie: 'AUD', singapore: 'SGD', singaporean: 'SGD',
  pakistani: 'PKR', nepali: 'NPR', nepalese: 'NPR', srilankan: 'LKR', kuwaiti: 'KWD', dinar: 'KWD',
  qatari: 'QAR', omani: 'OMR', bahraini: 'BHD', egyptian: 'EGP', nigerian: 'NGN', naira: 'NGN',
  mexican: 'MXN', brazilian: 'BRL', real: 'BRL', kenyan: 'KES', shilling: 'KES', vietnamese: 'VND', dong: 'VND',
  philippine: 'PHP', filipino: 'PHP', peso: 'PHP', hongkong: 'HKD', taiwan: 'TWD', swedish: 'SEK', krona: 'SEK',
  norwegian: 'NOK', krone: 'NOK', danish: 'DKK', polish: 'PLN', zloty: 'PLN', israeli: 'ILS', shekel: 'ILS',
};

function nameMap(rates) {
  if (cache.names && cache.names.size) return cache.names;
  const m = new Map();
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'currency' });
    for (const code of Object.keys(rates)) { const n = dn.of(code); if (n && n !== code) m.set(n.toLowerCase(), code); }
  } catch { /* Intl.DisplayNames not available */ }
  cache.names = m;
  return m;
}

// "taka", "BDT", "Bangladeshi Taka", "yuan", "€" ... -> "BDT" / "CNY" / "EUR". Returns null when unknown.
async function resolveCode(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const { rates } = await loadRates();
  const up = raw.toUpperCase();
  if (/^[A-Z]{3}$/.test(up) && rates[up]) return up;
  const low = raw.toLowerCase().replace(/[^\p{L}\p{N}$€£¥₹৳ ]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (ALIASES[low] && rates[ALIASES[low]]) return ALIASES[low];
  const names = nameMap(rates);
  if (names.has(low)) return names.get(low);
  for (const [n, code] of names) if (n.includes(low) && low.length >= 4) return code;
  for (const tok of low.split(' ')) if (ALIASES[tok] && rates[ALIASES[tok]]) return ALIASES[tok];
  for (const [n, code] of names) if (low.includes(n)) return code;
  return null;
}

const roundNice = (n) => {
  if (!isFinite(n)) return n;
  const a = Math.abs(n);
  const digits = a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
  return Number(n.toFixed(digits));
};

async function rateFromUsd(code) {
  const { rates } = await loadRates();
  if (!rates[code]) throw new Error(`Unknown currency ${code}`);
  return rates[code];
}

// Convert one amount into one or many targets.
async function convert(amount, from, to) {
  const value = Number(amount);
  if (!isFinite(value)) return { error: 'The amount is not a valid number.' };
  const data = await loadRates();
  const fromCode = await resolveCode(from || 'USD');
  if (!fromCode) return { error: `I do not recognise the currency "${from}".` };
  const targets = Array.isArray(to) ? to : [to];
  const out = [];
  for (const t of targets) {
    const code = await resolveCode(t);
    if (!code) { out.push({ to: String(t), error: `Unknown currency "${t}"` }); continue; }
    const rate = data.rates[code] / data.rates[fromCode];
    out.push({ from: fromCode, to: code, amount: value, result: roundNice(value * rate), rate: roundNice(rate) });
  }
  return { conversions: out, ratesAsOf: data.asOf || 'recent', source: data.source, note: 'Live market (mid) rates; banks and money-transfer services add a margin.' };
}

module.exports = { convert, resolveCode, rateFromUsd, loadRates };