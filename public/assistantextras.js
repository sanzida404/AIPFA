// AI assistant extras: voice conversation (speak to AIPFA, hear the answer) and budget-overspend alerts
// (gentle notification tone + device notification). Self-contained; it does not change any other page behaviour.
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);

  // ================= Budget alert: sound + device notification =================
  let actx = null, alerted = {}, notified = {};
  try { alerted = JSON.parse(localStorage.getItem('aipfa_budget_alerts_v2') || '{}'); } catch { alerted = {}; }
  try { notified = JSON.parse(localStorage.getItem('aipfa_budget_notifications_v2') || '{}'); } catch { notified = {}; }
  const saveAlerted = () => { try { localStorage.setItem('aipfa_budget_alerts_v2', JSON.stringify(alerted)); } catch { /* storage blocked */ } };
  const saveNotified = () => { try { localStorage.setItem('aipfa_budget_notifications_v2', JSON.stringify(notified)); } catch { /* storage blocked */ } };
  const appVisible = () => $('app') && !$('app').classList.contains('hidden');
  let notificationsEnabled = true;
  try { notificationsEnabled = localStorage.getItem('aipfa_notifications_enabled') !== 'false'; } catch { /* storage blocked; keep alerts enabled for this session */ }
  let deviceNotificationsEnabled = true;
  try { deviceNotificationsEnabled = localStorage.getItem('aipfa_device_notifications_enabled') !== 'false'; } catch { /* storage blocked; keep device alerts enabled for this session */ }

  function audio() {
    if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) actx = new AC(); }
    return actx;
  }
  let asked = false;
  const notificationButton = $('enable-budget-notifications');
  const notificationToggle = $('toggle-budget-notifications');
  const notificationStatus = $('budget-notification-status');
  function updateNotificationStatus() {
    if (!notificationStatus) return;
    if (notificationToggle) notificationToggle.textContent = notificationsEnabled ? 'Turn off alerts' : 'Turn on alerts';
    if (!('Notification' in window)) {
      notificationStatus.textContent = `AIPFA alerts are ${notificationsEnabled ? 'on' : 'off'}. This browser does not support device notifications.`;
      if (notificationButton) { notificationButton.textContent = 'Device notifications unsupported'; notificationButton.disabled = true; }
    } else if (Notification.permission === 'granted') {
      notificationStatus.textContent = `AIPFA alerts are ${notificationsEnabled ? 'on' : 'off'}; device notifications are ${deviceNotificationsEnabled ? 'on' : 'off'}. Browser permission is allowed.`;
      if (notificationButton) { notificationButton.textContent = deviceNotificationsEnabled ? 'Turn off device notifications' : 'Turn on device notifications'; notificationButton.disabled = false; }
    } else if (Notification.permission === 'denied') {
      notificationStatus.textContent = `AIPFA alerts are ${notificationsEnabled ? 'on' : 'off'}. Browser permission is blocked; allow notifications in this site’s address-bar permissions.`;
      if (notificationButton) { notificationButton.textContent = 'Blocked in browser settings'; notificationButton.disabled = true; }
    } else {
      notificationStatus.textContent = `AIPFA alerts are ${notificationsEnabled ? 'on' : 'off'}; device permission has not been granted.`;
      if (notificationButton) { notificationButton.textContent = 'Allow device notifications'; notificationButton.disabled = false; }
    }
  }
  if (notificationButton) notificationButton.addEventListener('click', async () => {
    if (!('Notification' in window)) { updateNotificationStatus(); return; }
    if (Notification.permission === 'granted') {
      deviceNotificationsEnabled = !deviceNotificationsEnabled;
      try { localStorage.setItem('aipfa_device_notifications_enabled', String(deviceNotificationsEnabled)); } catch { /* storage blocked; keep this-session preference */ }
      updateNotificationStatus();
      if (deviceNotificationsEnabled && notificationsEnabled) checkBudget();
      return;
    }
    if (Notification.permission === 'default') {
      asked = true;
      try {
        const permission = await Notification.requestPermission();
        updateNotificationStatus();
        if (permission === 'granted') checkBudget();
      } catch { notificationStatus.textContent = 'Could not open the browser permission prompt. Check this site’s permissions.'; }
      return;
    }
    updateNotificationStatus();
    if (Notification.permission === 'granted' && notificationsEnabled) checkBudget();
  });
  if (notificationToggle) notificationToggle.addEventListener('click', () => {
    notificationsEnabled = !notificationsEnabled;
    try { localStorage.setItem('aipfa_notifications_enabled', String(notificationsEnabled)); } catch { /* storage blocked */ }
    updateNotificationStatus();
    if (notificationsEnabled) checkBudget();
  });
  updateNotificationStatus();
  document.addEventListener('visibilitychange', updateNotificationStatus);
  function onFirstGesture() {
    const c = audio(); if (c && c.state === 'suspended') c.resume().catch(() => {});
    if (notificationsEnabled && !asked && appVisible() && 'Notification' in window && Notification.permission === 'default') {
      asked = true;
      Notification.requestPermission().then((permission) => { if (permission === 'granted') checkBudget(); }).catch(() => { asked = false; });
    }
  }
  ['click', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, onFirstGesture, { passive: true }));

  function playNotificationTone() {
    const c = audio(); if (!c || c.state !== 'running') return;
    const now = c.currentTime;
    // A short, soft two-note chime instead of the former loud alternating siren.
    [[659.25, 0], [783.99, 0.18]].forEach(([frequency, offset]) => {
      const osc = c.createOscillator(), gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, now + offset);
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.11, now + offset + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.34);
      osc.connect(gain); gain.connect(c.destination);
      osc.start(now + offset); osc.stop(now + offset + 0.36);
    });
  }
  async function notify(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const opts = { body, tag: 'aipfa-budget', renotify: true, silent: false, vibrate: [100, 60, 100], requireInteraction: true };
    try {
      const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
      if (reg) { await reg.showNotification(title, opts); return true; }
    } catch { /* fall through */ }
    try { new Notification(title, opts); return true; } catch { return false; }
  }
  const money = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');
  function alarm(s, playSound = true) {
    const text = `Warning: you have spent ${money(s.spent)} against your monthly budget of ${money(s.budget)}. You are ${money(s.overBy)} over budget.`;
    if (playSound) playNotificationTone();
    try { if (playSound && navigator.vibrate) navigator.vibrate([100, 60, 100]); } catch { /* ignore */ }
    const t = $('toast');
    if (t) {
      const line = document.createElement('div'); line.textContent = '⚠ ' + text;
      t.replaceChildren(line); t.classList.remove('hidden');
      t.onclick = () => t.classList.add('hidden');
      clearTimeout(alarm.timer); alarm.timer = setTimeout(() => t.classList.add('hidden'), 15000);
    }
  }
  let checking = false;
  async function checkBudget() {
    if (checking) return;
    checking = true;
    try {
      const r = await window.__aipfaFetch('/api/assistant/budget-status', { cache: 'no-store' });
      if (!r.ok) return;
      const s = await r.json();
      const key = `${s.user}|${s.periodStart}`;
      if (!s.over) {
        if (alerted[key]) { delete alerted[key]; saveAlerted(); }
        if (notified[key]) { delete notified[key]; saveNotified(); }
        return;
      }
      const warningText = `Warning: you have spent ${money(s.spent)} against your monthly budget of ${money(s.budget)}. You are ${money(s.overBy)} over budget.`;
      if (s.spent > (alerted[key] || 0) + 0.005) {
        alerted[key] = s.spent; saveAlerted();
        window.dispatchEvent(new CustomEvent('aipfa:notification', { detail: { id: `budget:${key}:${s.spent}`, title: 'Budget warning', text: warningText, level: 'danger' } }));
        alarm(s, notificationsEnabled);
      }
    if (notificationsEnabled && deviceNotificationsEnabled && 'Notification' in window && Notification.permission === 'granted' && s.spent > (notified[key] || 0) + 0.005) {
        if (await notify('AIPFA budget warning', warningText)) { notified[key] = s.spent; saveNotified(); }
      }
    } catch { /* network hiccup: try again next time */ } finally { checking = false; }
  }
  // Notice budget-relevant requests without touching the code that makes them.
  window.__aipfaFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const res = await window.__aipfaFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : input.url;
      const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      if (res.ok && ((method === 'POST' && /\/api\/(transactions|budget)(\?|$)/.test(url)) || (method === 'GET' && /\/api\/me(\?|$)/.test(url)))) setTimeout(checkBudget, 700);
    } catch { /* never break a request */ }
    return res;
  };
  setInterval(checkBudget, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkBudget(); });
  // ================= Voice conversation =================
  const form = $('form-chat'), input = $('chat-input');
  if (!form || !input) return;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  const sendBtn = form.querySelector('button:not([type="button"])');
  let lastReply = '', lastReplyWasVoiceInput = false, cloudSource = null, speechGeneration = 0;

  const live = document.createElement('button');
  live.type = 'button'; live.id = 'chat-live-voice'; live.className = 'assistant-icon-btn';
  live.title = 'Start voice conversation'; live.setAttribute('aria-label', 'Start voice conversation');
  const mic = document.createElement('button');
  mic.type = 'button'; mic.id = 'chat-mic'; mic.className = 'assistant-icon-btn'; mic.title = 'Talk to AIPFA';
  mic.setAttribute('aria-label', 'Talk to AIPFA');
  const voiceLanguage = document.createElement('select');
  voiceLanguage.id = 'chat-voice-language'; voiceLanguage.className = 'assistant-icon-btn';
  voiceLanguage.title = 'Choose the language you will speak';
  voiceLanguage.setAttribute('aria-label', 'Voice input language');
  const voiceLanguages = [
    ['auto', 'Auto'], ['en-US', 'English'], ['bn-BD', 'বাংলা'], ['zh-CN', '中文'],
    ['es-ES', 'Español'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch'], ['hi-IN', 'हिन्दी'],
    ['ar-SA', 'العربية'], ['pt-BR', 'Português'], ['ru-RU', 'Русский'], ['ja-JP', '日本語'],
    ['ko-KR', '한국어'], ['ur-PK', 'اردو'], ['it-IT', 'Italiano'], ['id-ID', 'Bahasa Indonesia'],
    ['tr-TR', 'Türkçe'], ['nl-NL', 'Nederlands'], ['vi-VN', 'Tiếng Việt'], ['th-TH', 'ไทย'],
  ];
  voiceLanguages.forEach(([value, label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; voiceLanguage.append(option); });
  voiceLanguage.value = 'bn-BD';
  let explicitVoiceLanguage = false, savedVoiceLanguage = '';
  const languageCodeAliases = { 'en-us':'eng', 'en-gb':'eng', 'en':'eng', 'bn-bd':'ben', 'bn-in':'ben', 'bn':'ben', 'zh-cn':'cmn', 'zh-tw':'cmn', 'zh':'cmn', 'es-es':'spa', 'es':'spa', 'fr-fr':'fra', 'fr':'fra', 'de-de':'deu', 'de':'deu', 'hi-in':'hin', 'hi':'hin', 'ar-sa':'ara', 'ar':'ara', 'pt-br':'por', 'pt-pt':'por', 'pt':'por', 'ru-ru':'rus', 'ru':'rus', 'ja-jp':'jpn', 'ja':'jpn', 'ko-kr':'kor', 'ko':'kor', 'ur-pk':'urd', 'ur':'urd', 'it-it':'ita', 'it':'ita', 'id-id':'ind', 'id':'ind', 'tr-tr':'tur', 'tr':'tur', 'nl-nl':'nld', 'nl':'nld', 'vi-vn':'vie', 'vi':'vie', 'th-th':'tha', 'th':'tha' };
  const mmsLanguageCode = (value) => languageCodeAliases[String(value || '').toLowerCase().replace(/_/g, '-')] || String(value || '').toLowerCase();
  try {
    const saved = localStorage.getItem('aipfa_voice_language') || '';
    if (voiceLanguages.some(([value]) => value === saved)) { voiceLanguage.value = saved; explicitVoiceLanguage = true; }
    else if (/^[a-z]{3}(?:-[a-z0-9_]+)*$/i.test(saved)) { savedVoiceLanguage = saved; explicitVoiceLanguage = true; }
  } catch { /* storage blocked */ }
  voiceLanguage.style.flex = '0 0 92px'; voiceLanguage.style.width = '92px'; voiceLanguage.style.minWidth = '92px'; voiceLanguage.style.height = '42px';
  voiceLanguage.style.borderRadius = '7px'; voiceLanguage.style.padding = '0 7px'; voiceLanguage.style.appearance = 'auto';
  voiceLanguage.addEventListener('change', () => {
    explicitVoiceLanguage = true;
    try { localStorage.setItem('aipfa_voice_language', voiceLanguage.value); } catch { /* storage blocked */ }
    warmTts(voiceLanguage.value);
    // Web Speech keeps the locale used when a recognition session starts.
    // Stop this session so its normal onend handler restarts with the new locale.
    if (listening && rec) {
      clearTimeout(liveSilenceTimer);
      interimText = '';
      try { rec.stop(); } catch { rec = null; startRecognition(); }
    }
  });
  (async () => {
    try {
      const response = await fetch('/api/assistant/tts-languages', { cache: 'no-store' });
      if (!response.ok) return;
      const languages = await response.json();
      const known = new Set(voiceLanguages.filter(([value]) => value !== 'auto').map(([value]) => mmsLanguageCode(value)));
      const other = document.createElement('optgroup'); other.label = 'More supported languages';
      languages.forEach(({ code, name }) => {
        if (!code || known.has(code)) return;
        const option = document.createElement('option'); option.value = code; option.textContent = name || code; option.dataset.mmsCode = code; other.append(option);
      });
      if (other.options.length) voiceLanguage.append(other);
      if (savedVoiceLanguage && [...voiceLanguage.options].some((option) => option.value === savedVoiceLanguage)) voiceLanguage.value = savedVoiceLanguage;
    } catch { /* keep the built-in common language options */ }
  })();
  const spk = document.createElement('button');
  spk.type = 'button'; spk.id = 'chat-speak'; spk.className = 'assistant-icon-btn'; spk.setAttribute('aria-label', 'Read every answer aloud');
  const expand = document.createElement('button');
  expand.type = 'button'; expand.id = 'chat-expand'; expand.className = 'btn ghost small chat-expand';
  expand.setAttribute('aria-label', 'Expand assistant chat'); expand.setAttribute('aria-pressed', 'false');
  const expandIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m13-5v3a2 2 0 0 1-2 2h-3"/></svg>';
  const collapseIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v5H3m13-5v5h5M3 16h5v5m13-5h-5v5"/></svg>';
  const chatPanel = $('tab-assistant').querySelector('.panel.chat');
  const chatHeader = chatPanel && chatPanel.querySelector('.row.between');
  if (chatHeader) {
    const tools = document.createElement('div'); tools.className = 'row chat-header-tools';
    const clearButton = $('chat-clear'); chatHeader.insertBefore(tools, clearButton); tools.append(expand, clearButton);
    expand.innerHTML = expandIcon;
    expand.addEventListener('click', () => {
      const expanded = chatPanel.classList.toggle('chat-expanded');
      document.body.classList.toggle('aipfa-chat-expanded', expanded);
      expand.innerHTML = expanded ? collapseIcon : expandIcon;
      expand.title = expanded ? 'Restore assistant chat size' : 'Expand assistant chat';
      expand.setAttribute('aria-label', expand.title); expand.setAttribute('aria-pressed', String(expanded));
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && chatPanel.classList.contains('chat-expanded')) expand.click();
    });
  }
  [live, mic, spk].forEach((button) => { button.style.flex = '0 0 42px'; button.style.width = '42px'; button.style.minWidth = '42px'; button.style.height = '42px'; button.style.borderRadius = '7px'; });
  form.style.gap = '8px';
  let speakAll = false; try { speakAll = localStorage.getItem('aipfa_speak_all') === '1'; } catch { /* ignore */ }
  function stopVoiceOutput() {
    speechGeneration++;
    if (synth) synth.cancel();
    if (cloudSource) { const active = cloudSource; cloudSource = null; try { active.stop(); } catch { /* already ended */ } }
  }
  let liveConversation = false;
  let liveSilenceTimer = null;
  const liveIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 14v-3a9 9 0 0 1 18 0v3"/><rect x="3" y="13" width="4" height="7" rx="2"/><rect x="17" y="13" width="4" height="7" rx="2"/><path d="M20 19c-.8 1.2-2.1 2-4 2h-2"/></svg>';
  const paintLive = () => {
    live.innerHTML = liveConversation ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>' : liveIcon;
    live.title = liveConversation ? 'Stop voice conversation' : 'Start voice conversation';
    live.setAttribute('aria-label', live.title);
    live.setAttribute('aria-pressed', String(liveConversation));
    mic.disabled = false;
  };
  const speakerIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
  const paintSpk = () => { spk.innerHTML = speakAll ? speakerIcon : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m16 9 5 6"/><path d="m21 9-5 6"/></svg>'; spk.title = speakAll ? 'Reading every answer aloud (click to turn off)' : 'Voice questions receive spoken answers (click to read all answers aloud)'; spk.setAttribute('aria-pressed', String(speakAll)); };
  const paintMic = (on) => { const active = on && !liveConversation; listening = on; mic.innerHTML = active ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4m-4 0h8"/></svg>'; mic.title = liveConversation ? on ? 'Listening in voice conversation; click to cancel this take' : 'Interrupt the assistant and speak' : on ? 'Listening… click to stop' : 'Talk to AIPFA'; mic.setAttribute('aria-label', mic.title); mic.setAttribute('aria-pressed', String(active)); mic.style.outline = active ? '2px solid var(--danger)' : ''; };
  paintSpk();
  paintLive();
  form.insertBefore(spk, sendBtn); form.insertBefore(live, sendBtn); form.insertBefore(mic, spk); form.insertBefore(voiceLanguage, mic);

  const say = (text) => { // small note inside the chat log
    const b = document.createElement('div'); b.className = 'bubble assistant'; b.textContent = text;
    $('chat-log').append(b); $('chat-log').scrollTop = 1e9;
  };
  function keyboardDictationFallback(message) {
    input.focus();
    say(message || 'This browser does not provide in-page voice recognition. Tap the microphone on your device keyboard to dictate here, then press Send.');
  }
  spk.addEventListener('click', () => {
    speakAll = !speakAll; try { localStorage.setItem('aipfa_speak_all', speakAll ? '1' : '0'); } catch { /* ignore */ }
    if (!speakAll) stopVoiceOutput();
    else { if (synth) synth.resume(); warmTts(voiceLanguage.value); }
    paintSpk();
    if (speakAll && lastReply && !liveConversation) speak(lastReply, null, lastReplyWasVoiceInput);
  });

  // ---- speaking ----
  function fetchVoiceWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
  }
  const warmedTtsLanguages = new Set();
  const warmingTtsLanguages = new Map();
  function warmTts(language) {
    const key = String(language || voiceLanguage.value || 'en-US');
    if (warmedTtsLanguages.has(key)) return Promise.resolve();
    if (warmingTtsLanguages.has(key)) return warmingTtsLanguages.get(key);
    const pending = fetchVoiceWithTimeout('/api/assistant/tts', {
      method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'AIPFA.', language: key }),
    }, 180000).then(async (response) => {
      if (!response.ok) throw new Error('TTS warm-up failed');
      await response.arrayBuffer();
      warmedTtsLanguages.add(key);
    }).catch(() => { /* The conversation can still use an installed device voice. */ })
      .finally(() => warmingTtsLanguages.delete(key));
    warmingTtsLanguages.set(key, pending);
    return pending;
  }
  function speakable(text) {
    return String(text || '')
      .split('\n').filter((l) => !l.startsWith('📎 ')).join(' ')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/\$\s?([\d,]+(?:\.\d+)?)/g, '$1 dollars')
      // Keep chat text localized, but pass native numeral glyphs to TTS engines
      // as digits they can normalize and pronounce instead of silently skipping.
      .replace(/[০১২৩৪৫৬৭৮৯٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹०१२३४५६७८९๐๑๒๓๔๕๖๗๘๙]/g, (digit) => {
        const sets = ['০১২৩৪৫৬৭৮৯', '٠١٢٣٤٥٦٧٨٩', '۰۱۲۳۴۵۶۷۸۹', '०१२३४५६७८९', '๐๑๒๓๔๕๖๗๘๙'];
        const set = sets.find((digits) => digits.includes(digit));
        return set ? String(set.indexOf(digit)) : digit;
      })
      .replace(/[*#_`>|~]/g, ' ').replace(/^\s*-\s+/gm, '').replace(/\s+/g, ' ').trim();
  }
  function speechLanguage(text, voiceInput = false) {
    const value = String(text || '');
    const preferred = (navigator.languages && navigator.languages[0]) || navigator.language || 'en-US';
    const preferredBase = preferred.toLowerCase().split(/[-_]/)[0];
    const latinLetters = (value.match(/[A-Za-z]/g) || []).length;
    const nonLatinLetters = (value.match(/[\p{Script=Bengali}\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Cyrillic}\p{Script=Hebrew}\p{Script=Greek}\p{Script=Han}]/gu) || []).length;
    // Ignore short foreign-script names embedded in an otherwise English answer
    // (for example, a Chinese utility-company name in an English bill summary).
    if (latinLetters >= 24 && latinLetters > nonLatinLetters * 2) return 'en-US';
    const scriptMatches = [
      [/\p{Script=Bengali}/u, 'bn-BD'],
      [/\p{Script=Arabic}/u, /[پچژگٹڈڑںھہےے]/u.test(value) ? 'ur-PK' : (voiceLanguage.value !== 'auto' && ['ar', 'fa', 'ur'].includes(voiceLanguage.value.toLowerCase().split(/[-_]/)[0]) ? voiceLanguage.value : (['ar', 'fa'].includes(preferredBase) ? preferred : 'ar-SA'))],
      [/\p{Script=Devanagari}/u, ['hi', 'mr', 'ne'].includes(preferredBase) ? preferred : 'hi-IN'],
      [/\p{Script=Hiragana}|\p{Script=Katakana}/u, 'ja-JP'],
      [/\p{Script=Hangul}/u, 'ko-KR'],
      [/\p{Script=Thai}/u, 'th-TH'],
      [/\p{Script=Cyrillic}/u, ['ru', 'uk', 'bg', 'sr'].includes(preferredBase) ? preferred : 'ru-RU'],
      [/\p{Script=Hebrew}/u, 'he-IL'],
      [/\p{Script=Greek}/u, 'el-GR'],
      [/\p{Script=Han}/u, ['zh', 'ja'].includes(preferredBase) ? preferred : 'zh-CN'],
    ];
    const detected = scriptMatches.find(([pattern]) => pattern.test(value));
    if (detected) return detected[1];
    if (voiceInput && voiceLanguage.value !== 'auto') return voiceLanguage.value;
    if (explicitVoiceLanguage && voiceLanguage.value !== 'auto') return voiceLanguage.value;
    return ['bn', 'zh', 'ar', 'fa', 'ur', 'hi', 'mr', 'ne', 'ja', 'ko', 'th', 'he', 'el', 'ru', 'uk', 'bg', 'sr'].includes(preferredBase) ? 'en-US' : preferred;
  }
  function pickVoice(language) {
    if (!synth) return null;
    const v = synth.getVoices();
    const wanted = String(language || '').toLowerCase().replace('_', '-');
    const prefix = wanted.split('-')[0];
    if (prefix === 'en') {
      const femaleEnglish = v.find((x) => x.lang.toLowerCase().split(/[-_]/)[0] === 'en'
        && /female|aria|jenny|zira|samantha|ava|serena|victoria|karen|moira|tessa|fiona|hazel|google us english/i.test(x.name));
      if (femaleEnglish) return femaleEnglish;
    }
    if (prefix === 'bn' || prefix === 'tr') {
      const femaleNames = prefix === 'bn'
        ? /female|nusrat|sabiha|nabanita|apar?na|madhurima|riya|sangeeta|tanjina/i
        : /female|filiz|dilara|emel|seda|zehra|yelda|aylin|selin|zeynep|ipek|ayse|elif|merve|asli|burcu|ece|derya|ayla/i;
      const femaleLocalVoice = v.find((x) => x.lang.toLowerCase().split(/[-_]/)[0] === prefix && femaleNames.test(x.name));
      if (femaleLocalVoice) return femaleLocalVoice;
    }
    const match = v.find((x) => x.lang.toLowerCase().replace('_', '-') === wanted)
      || v.find((x) => x.lang.toLowerCase().split(/[-_]/)[0] === prefix)
      || null;
    if (match || prefix !== 'en') return match;
    return v.find((x) => /^en[-_]US/i.test(x.lang) && /natural|aria|jenny|zira|samantha|google us/i.test(x.name))
      || v.find((x) => /^en[-_]US/i.test(x.lang)) || v.find((x) => /^en/i.test(x.lang)) || null;
  }
  function waitForSpeechVoices() {
    if (!synth) return Promise.resolve();
    if (synth.getVoices().length) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true; clearTimeout(timer);
        synth.removeEventListener?.('voiceschanged', finish);
        resolve();
      };
      const timer = setTimeout(finish, 1800);
      synth.addEventListener?.('voiceschanged', finish, { once: true });
    });
  }
  async function speakMmsChunks(chunks, language, generation) {
    const context = audio();
    if (!context) return false;
    for (const chunk of chunks) {
      if (generation !== speechGeneration) return true;
      const response = await fetchVoiceWithTimeout('/api/assistant/tts', {
        method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chunk.trim(), language }),
      }, 180000);
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        throw new Error(detail.error || 'Free multilingual voice could not be loaded.');
      }
      const encoded = await response.arrayBuffer();
      if (generation !== speechGeneration) return true;
      if (context.state === 'suspended') await context.resume();
      const decoded = await context.decodeAudioData(encoded.slice(0));
      await new Promise((resolve, reject) => {
        if (generation !== speechGeneration) { resolve(); return; }
        const source = context.createBufferSource();
        cloudSource = source; source.buffer = decoded; source.playbackRate.value = /^(bn|tr|ur|ar)(?:-|$)/i.test(language) ? 1.12 : 1.06; source.connect(context.destination);
        source.onended = () => { if (cloudSource === source) cloudSource = null; resolve(); };
        try { source.start(); } catch (error) { cloudSource = null; reject(error); }
      });
    }
    return true;
  }
  const missingSpeechVoices = new Set();
  let notifiedMmsFallback = false;
  function speak(text, onDone, voiceInput = false) {
    if (!synth && !audio()) { say('Voice playback is not available in this browser.'); if (onDone) onDone(); return; }
    const clean = speakable(text); if (!clean) { if (onDone) onDone(); return; }
    let finished = false;
    stopVoiceOutput(); const generation = speechGeneration;
    const finish = () => { if (finished || generation !== speechGeneration) return; finished = true; if (onDone) onDone(); };
    if (synth) synth.resume();
    const language = speechLanguage(clean, voiceInput);
    const maxChunkLength = /^(bn|tr|ur|ar)(?:-|$)/i.test(language) ? 800 : 240;
    const parts = clean.match(/[^.!?。！？।]+[.!?。！？।]*\s*/gu) || [clean];
    const chunks = []; let cur = '';
    for (const part of parts) {
      const words = part.match(/\S+\s*/gu) || [part];
      for (const word of words) {
        if (cur && (cur + word).length > maxChunkLength) { chunks.push(cur.trim()); cur = ''; }
        if (word.length > maxChunkLength) {
          for (let offset = 0; offset < word.length; offset += maxChunkLength) chunks.push(word.slice(offset, offset + maxChunkLength));
        } else cur += word;
      }
    }
    if (cur) chunks.push(cur);
    let replyVoice = null;
    // Queue one utterance at a time: some browsers drop later utterances when a
    // long response is queued all at once or the voice list loads late.
    let i = 0;
    const playNext = () => {
      if (generation !== speechGeneration) return;
      if (i >= chunks.length) { finish(); return; }
      const u = new SpeechSynthesisUtterance(chunks[i++].trim());
      if (!replyVoice) replyVoice = pickVoice(language);
      const currentVoice = replyVoice;
      u.lang = currentVoice ? currentVoice.lang : language; if (currentVoice) u.voice = currentVoice; u.rate = 1.04;
      u.onend = playNext;
      u.onerror = (event) => {
        if (event.error !== 'canceled' && event.error !== 'interrupted') say('Voice playback could not start. Check your browser sound and try the speaker button.');
        finish();
      };
      try { synth.speak(u); } catch { say('Voice playback could not start. Check your browser sound and try the speaker button.'); finish(); }
    };
    // Use a matching installed voice immediately. This avoids waiting for a
    // local TTS model when the current device can already speak the language.
    if (pickVoice(language)) { playNext(); return; }
    (async () => {
      await waitForSpeechVoices();
      if (generation !== speechGeneration) return;
      if (pickVoice(language)) { playNext(); return; }
      let modelError = null;
      try { if (await speakMmsChunks(chunks, language, generation)) { finish(); return; } }
      catch (error) { modelError = error; }
      if (!synth) { say(modelError ? modelError.message : 'The free multilingual voice model is unavailable.'); finish(); return; }
      if (!pickVoice(language) && !missingSpeechVoices.has(language)) {
        missingSpeechVoices.add(language);
        say(`This device or browser has no ${language} speech voice installed. Add a matching text-to-speech voice in device settings to hear this language clearly.`);
      }
      // Never let the browser substitute the previous/default language voice
      // (for example, Chinese) when this reply is Bengali or another language.
      if (!pickVoice(language)) { if (modelError) say(modelError.message); finish(); return; }
      if (modelError && !notifiedMmsFallback) {
        notifiedMmsFallback = true;
        say('Free multilingual voice is unavailable; using this device’s installed voice.');
      }
      setTimeout(playNext, 120);
    })();
  }
  if (synth) {
    synth.getVoices();
    // Some mobile browsers populate their installed voices asynchronously.
    synth.addEventListener?.('voiceschanged', () => synth.getVoices());
  }
  function requestsSpokenReply(text) {
    const wantsText = /\b(?:reply|answer|respond|write|give|send|show|provide|tell)\b.{0,30}\b(?:in|as)\s+text\b|\btext[- ]only\b|\bwritten (?:reply|answer|response)\b|\bin writing\b|\btype it\b|\bwrite it\b|\bwithout voice\b|\bno voice\b|\b(?:don't|do not) speak\b/i.test(text)
      && !/\b(?:not|don't|do not|never)\s+(?:in|as)\s+text\b/i.test(text);
    const asksVoice = /\b(hear (?:your|you)(?: voice)?|want to hear|listen to (?:you|your voice)|talk to me|speak to me|use your voice|give me (?:your )?voice|say it (?:out loud|aloud)|read (?:it|that|this) to me|voice (?:reply|response)|answer (?:me )?verbally|can you speak|speak (?:in|with) (?:your )?voice|voice please|bolo (?:voice|aloud)|voice e bolo)\b/i.test(text);
    return asksVoice && !wantsText;
  }
  window.addEventListener('aipfa:reply', (e) => {
    const d = e.detail || {}; lastReply = d.text || ''; lastReplyWasVoiceInput = d.voiceInput === true;
    if (liveConversation) {
      const listenForNextTurn = () => {
        if (liveConversation) {
          finalText = ''; interimText = ''; input.value = '';
          startListening();
        }
      };
      if (speakAll) speak(lastReply, listenForNextTurn, lastReplyWasVoiceInput);
      else listenForNextTurn();
    } else if (speakAll) speak(lastReply, null, lastReplyWasVoiceInput);
  });

  // ---- listening ----
  // Use the browser's built-in speech recognition so voice input requires no
  // paid transcription API. Keep the session alive across browser time limits.
  let rec = null, listening = false, finalText = '', interimText = '', pendingVoiceSend = false, discardPendingCapture = false, restartTimer = null;
  paintMic(false);
  form.addEventListener('submit', (e) => {
    // Resume speech output from the user's Send gesture where mobile browsers
    // require an interaction before audio playback can begin.
    const submittedText = input.value.trim();
    if (synth && (speakAll || window.__aipfaVoiceNext || requestsSpokenReply(submittedText))) synth.resume();
    if (!listening || !rec) return;
    e.preventDefault(); e.stopImmediatePropagation();
    pendingVoiceSend = true;
    stopListening();
  }, true);
  function startRecognition() {
    if (!listening || !SR) return;
    const textBeforeThisRecognition = finalText;
    const recognitionLocaleByMmsCode = { eng: 'en-IN', ben: 'bn-BD', cmn: 'zh-CN', spa: 'es-ES', fra: 'fr-FR', deu: 'de-DE', hin: 'hi-IN', ara: 'ar-SA', por: 'pt-BR', rus: 'ru-RU', kor: 'ko-KR', urd: 'ur-PK', ita: 'it-IT', ind: 'id-ID', tur: 'tr-TR', nld: 'nl-NL', vie: 'vi-VN', tha: 'th-TH' };
    const selectedInputLanguage = voiceLanguage.value;
    rec = new SR(); rec.lang = selectedInputLanguage === 'auto' ? ((navigator.languages && navigator.languages[0]) || navigator.language || 'en-US') : (recognitionLocaleByMmsCode[selectedInputLanguage] || selectedInputLanguage); rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1;
    rec.onresult = (event) => {
      // Ignore any trailing results from the old locale after the user switches languages.
      if (selectedInputLanguage !== voiceLanguage.value) return;
      let currentFinal = '', interim = '';
      for (let i = 0; i < event.results.length; i++) {
        const text = event.results[i][0].transcript.trim();
        if (event.results[i].isFinal) currentFinal += text + ' ';
        else interim += text + ' ';
      }
      finalText = textBeforeThisRecognition + currentFinal;
      interimText = interim.trim() ? interim : '';
      input.value = (finalText + interimText).trim().slice(0, 1000);
      if (liveConversation && (finalText || interimText)) {
        clearTimeout(liveSilenceTimer);
        const sendWhenStable = () => {
          if (!liveConversation || !(finalText || interimText).trim()) return;
          if (interimText.trim()) { liveSilenceTimer = setTimeout(sendWhenStable, 500); return; }
          pendingVoiceSend = true;
          stopListening();
        };
        liveSilenceTimer = setTimeout(sendWhenStable, 1500);
      }
    };
    rec.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        listening = false; pendingVoiceSend = false; liveConversation = false; paintMic(false); paintLive();
        say('Microphone access is blocked. Allow microphone access for this site, then try again.');
      } else if (event.error === 'audio-capture') {
        listening = false; pendingVoiceSend = false; liveConversation = false; paintMic(false); paintLive(); say('No microphone was found on this device.');
      } else if (event.error === 'network') {
        listening = false; pendingVoiceSend = false; liveConversation = false; paintMic(false); paintLive();
        keyboardDictationFallback('In-page voice recognition is unavailable right now. Your captured words are still in the input; you can finish dictating with your device keyboard microphone, then press Send.');
      }
      // no-speech is recoverable: onend restarts recognition while the user is
      // still in listening mode.
    };
    rec.onend = () => {
      rec = null;
      if (interimText) finalText += interimText.trim() + ' ';
      interimText = '';
      input.value = finalText.trim().slice(0, 1000);
      if (listening) {
        clearTimeout(restartTimer);
        restartTimer = setTimeout(startRecognition, 250);
        return;
      }
      finalizeCapture();
    };
    try { rec.start(); }
    catch { clearTimeout(restartTimer); restartTimer = setTimeout(startRecognition, 500); }
  }
  function startListening() {
    if (!window.isSecureContext) {
      keyboardDictationFallback('Microphone access needs a secure HTTPS connection (localhost is also allowed). Open the deployed site over HTTPS, or use your device keyboard microphone to dictate.');
      return;
    }
    if (!SR) { keyboardDictationFallback(); return; }
    // Microphone use must leave the independently saved speaker setting alone.
    try { speakAll = localStorage.getItem('aipfa_speak_all') === '1'; } catch { /* keep current preference */ }
    paintSpk();
    stopVoiceOutput(); finalText = ''; interimText = ''; input.value = ''; pendingVoiceSend = false; discardPendingCapture = false;
    listening = true; paintMic(true); startRecognition();
  }
  function stopListening() {
    listening = false; clearTimeout(restartTimer); paintMic(false);
    if (rec) { try { rec.stop(); return; } catch { rec = null; } }
    finalizeCapture();
  }
  live.addEventListener('click', () => {
    if (liveConversation) {
      liveConversation = false; pendingVoiceSend = false; discardPendingCapture = true;
      clearTimeout(liveSilenceTimer); paintLive(); stopVoiceOutput(); stopListening();
      say('Voice conversation stopped.');
      return;
    }
    if (!SR) { keyboardDictationFallback('Live voice conversation is not supported in this browser. Use the microphone button for device keyboard dictation, or try a browser with speech recognition support.'); return; }
    if (!synth && !audio()) { say('Spoken replies are not supported in this browser.'); return; }
    if (!window.isSecureContext) { keyboardDictationFallback('Live voice conversation needs HTTPS and microphone permission. Open the deployed site over HTTPS, then try again.'); return; }
    liveConversation = true; paintLive();
    say('Voice conversation is on. Speak naturally; pause for 1.5 seconds when you finish a turn.');
    warmTts(voiceLanguage.value);
    startListening();
  });
  function finalizeCapture() {
    if (discardPendingCapture) {
      discardPendingCapture = false; pendingVoiceSend = false; finalText = ''; interimText = ''; input.value = '';
      window.__aipfaVoiceNext = false;
      return;
    }
    input.value = (finalText + interimText).trim().slice(0, 1000);
    interimText = '';
    if (input.value) {
      const asksForText = /\b(?:reply|answer|respond|write|give|send|show|provide|tell)\b.{0,30}\b(?:in|as)\s+text\b|\btext[- ]only\b|\bwritten (?:reply|answer|response)\b|\bin writing\b|\btype it\b|\bwrite it\b|\bwithout voice\b|\bno voice\b|\b(?:don't|do not) speak\b/i.test(input.value)
        && !/\b(?:not|don't|do not|never)\s+(?:in|as)\s+text\b/i.test(input.value);
      window.__aipfaVoiceNext = !asksForText;
    }
    if (pendingVoiceSend) {
      pendingVoiceSend = false;
      if (input.value && form.requestSubmit) form.requestSubmit();
      else if (input.value) form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    }
  }
  mic.addEventListener('click', () => {
    if (liveConversation) {
      if (listening) { pendingVoiceSend = false; discardPendingCapture = true; stopListening(); }
      else startListening();
      return;
    }
    if (listening) stopListening(); else startListening();
  });
})();
