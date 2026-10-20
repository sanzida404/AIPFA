(() => {
  const $ = (id) => document.getElementById(id);
  const usd = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');
  const normalizeCurrencyText = (text) => String(text || '').replace(/৳/g, '$');
  const COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#64748b'];
  let me = null, pie = null, line = null, monthComparison = null, selectedPeriodOverride = null, refreshSequence = 0;
  let notificationStorageKey = '', notificationEntries = [], notificationObserver = null;
  let activeLoginChallenge = '', loginPollTimer = null, loginApproved = false, loginNeedsPin = false;
  function applyTheme(theme) {
    document.documentElement.classList.toggle('dark-theme', theme === 'dark');
    document.documentElement.classList.toggle('light-theme', theme === 'light');
  }
  let savedTheme = 'system'; try { savedTheme = localStorage.getItem('aipfa_theme') || 'system'; } catch { /* storage blocked */ }
  if (!['system', 'dark', 'light'].includes(savedTheme)) savedTheme = 'system';
  applyTheme(savedTheme);

  function monthIndex(date) { const [year, month] = date.split('-').map(Number); return year * 12 + month - 1; }
  function cycleStartFromAnchor(anchor, offset) {
    const [anchorYear, anchorMonth, anchorDay] = anchor.split('-').map(Number);
    const targetIndex = monthIndex(anchor) + offset;
    const year = Math.floor(targetIndex / 12), month = targetIndex % 12;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const anchorLastDay = new Date(Date.UTC(anchorYear, anchorMonth, 0)).getUTCDate();
    const day = anchorDay === anchorLastDay ? lastDay : Math.min(anchorDay, lastDay);
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  function cycleStartForDate(anchor, date) {
    let offset = monthIndex(date) - monthIndex(anchor);
    if (date < cycleStartFromAnchor(anchor, offset)) offset--;
    return cycleStartFromAnchor(anchor, offset);
  }
  function cycleBounds(anchor, start) {
    if (monthIndex(start) < monthIndex(anchor) && start.endsWith('-01')) {
      const [year, month] = start.split('-').map(Number);
      const next = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
      const days = Math.round((Date.parse(`${next}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
      const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
      return { start, end, days };
    }
    const offset = monthIndex(start) - monthIndex(anchor);
    const next = cycleStartFromAnchor(anchor, offset + 1);
    const [year, month, day] = next.split('-').map(Number);
    const [sy, sm, sd] = start.split('-').map(Number);
    const days = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(sy, sm - 1, sd)) / 86400000);
    const end = new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
    return { start, end, days };
  }

  function periodForMonth(monthValue) {
    if (!monthValue) return me.currentPeriod || new Date().toISOString().slice(0, 7);
    const firstDay = `${monthValue}-01`;
    if (monthIndex(firstDay) < monthIndex(me.accountStart)) return firstDay;
    return cycleStartFromAnchor(me.accountStart, monthIndex(firstDay) - monthIndex(me.accountStart));
  }
  function periodLabel(start, end) {
    const startMonth = start.slice(0, 7), endMonth = end.slice(0, 7);
    const formatMonth = (month) => new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
    if (startMonth === endMonth) return formatMonth(startMonth);
    const formatDate = (date) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
    return `${formatDate(start)} – ${formatDate(end)}`;
  }

  async function api(path, method = 'GET', body) {
    const r = await fetch('/api' + path, {
      method,
      cache: ['/summary', '/transactions'].includes(path.split('?')[0]) ? 'no-store' : 'default',
      headers: (body || method !== 'GET') ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : (method !== 'GET' ? '{}' : undefined),
    });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && me) { me = null; showAuth(); }
    if (!r.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };

  function saveNotifications() {
    if (!notificationStorageKey) return;
    try { localStorage.setItem(notificationStorageKey, JSON.stringify(notificationEntries.slice(-100))); } catch { /* storage blocked */ }
  }
  function updateNotificationCount() {
    const badge = $('notification-count');
    const unread = notificationEntries.reduce((count, item) => count + (item.seen ? 0 : 1), 0);
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.classList.toggle('hidden', unread === 0);
    $('notification-toggle').setAttribute('aria-label', unread ? `Notifications, ${unread} unread` : 'Notifications');
  }
  function markNotificationSeen(id, itemElement) {
    const item = notificationEntries.find((entry) => entry.id === id);
    if (!item || item.seen) return;
    item.seen = true;
    if (itemElement) { itemElement.classList.remove('unseen'); itemElement.classList.add('seen'); }
    saveNotifications(); updateNotificationCount();
  }
  function renderNotifications() {
    const list = $('notification-list'), empty = $('notification-empty');
    if (!list) return;
    if (notificationObserver) { notificationObserver.disconnect(); notificationObserver = null; }
    list.replaceChildren();
    empty.classList.toggle('hidden', notificationEntries.length > 0);
    notificationEntries.slice().reverse().forEach((item) => {
      const row = el('li', undefined, `notification-item ${item.seen ? 'seen' : 'unseen'} ${item.level || 'info'}`);
      row.tabIndex = 0; row.dataset.notificationId = item.id;
      row.append(el('span', item.title || 'Finance update', 'notification-title'));
      row.append(el('span', item.text));
      row.append(el('span', new Date(item.createdAt).toLocaleString(), 'notification-time'));
      row.addEventListener('click', () => markNotificationSeen(item.id, row));
      row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); markNotificationSeen(item.id, row); } });
      list.append(row);
    });
    updateNotificationCount();
    const center = $('notification-center');
    if (!center.classList.contains('hidden')) {
      if ('IntersectionObserver' in window) {
        notificationObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
          if (entry.isIntersecting) {
            markNotificationSeen(entry.target.dataset.notificationId, entry.target);
            notificationObserver?.unobserve(entry.target);
          }
        }), { root: list, threshold: 0.6 });
        list.querySelectorAll('.unseen').forEach((row) => notificationObserver.observe(row));
      }
    }
  }
  function addNotification({ id, title, text, level = 'info' } = {}) {
    if (!text) return;
    const notificationId = id || `event:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    if (notificationEntries.some((item) => item.id === notificationId)) return;
    notificationEntries.push({ id: notificationId, title: title || 'Finance update', text: normalizeCurrencyText(text), level, createdAt: new Date().toISOString(), seen: false });
    notificationEntries = notificationEntries.slice(-100);
    saveNotifications(); renderNotifications();
  }
  function initNotifications(loginId) {
    notificationStorageKey = `aipfa_notifications_${String(loginId || 'account').replace(/[^a-zA-Z0-9_-]/g, '')}`;
    try {
      const stored = JSON.parse(localStorage.getItem(notificationStorageKey) || '[]');
      notificationEntries = Array.isArray(stored) ? stored.filter((item) => item && typeof item.id === 'string' && typeof item.text === 'string').slice(-100) : [];
    } catch { notificationEntries = []; }
    renderNotifications();
  }
  function activateTab(tabName) {
    document.querySelectorAll('#tabs button').forEach((button) => button.classList.toggle('active', button.dataset.tab === tabName));
    document.querySelectorAll('.tab').forEach((section) => section.classList.toggle('hidden', section.id !== 'tab-' + tabName));
    if (tabName !== 'dashboard') {
      $('notification-center').classList.add('hidden');
      $('notification-toggle').setAttribute('aria-expanded', 'false');
    }
    if (tabName === 'assistant') loadChat();
    if (['transactions', 'budget', 'dashboard'].includes(tabName)) refresh();
  }
  window.addEventListener('aipfa:notification', (event) => addNotification(event.detail || {}));
  $('notification-toggle').addEventListener('click', () => {
    const center = $('notification-center');
    const opening = center.classList.contains('hidden');
    if (opening) {
      activateTab('dashboard');
      center.classList.remove('hidden');
      $('notification-toggle').setAttribute('aria-expanded', 'true');
      renderNotifications();
      center.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      center.classList.add('hidden');
      $('notification-toggle').setAttribute('aria-expanded', 'false');
    }
  });
  $('notification-close').addEventListener('click', () => {
    $('notification-center').classList.add('hidden');
    $('notification-toggle').setAttribute('aria-expanded', 'false');
  });

  function authMsg(text, ok) {
    const m = $('auth-msg'); m.textContent = text; m.className = 'msg ' + (ok ? 'ok' : 'err');
  }
  function toast(items) {
    if (!items.length) return;
    const t = $('toast'); t.replaceChildren(...items.map((i) => el('div', i.text)));
    t.onclick = () => t.classList.add('hidden');
    t.classList.remove('hidden'); clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.add('hidden'), 12000);
  }
  function showAdvice(items) {
    const ul = $('tx-advice'); ul.replaceChildren();
    (items || []).forEach((i) => ul.append(el('li', normalizeCurrencyText(i.text), i.level)));
    $('tx-advice-panel').classList.toggle('hidden', !(items && items.length));
  }
  function busy(form, on) { form.querySelectorAll('button').forEach((b) => (b.disabled = on)); }

  // ----- auth screens -----
  function showAuth() { $('app').classList.add('hidden'); $('welcome-screen').classList.add('hidden'); $('auth').classList.remove('hidden'); }
  document.querySelectorAll('[data-show]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    ['form-login', 'form-signup', 'form-forgot'].forEach((f) => $(f).classList.toggle('hidden', f !== a.dataset.show));
    $('auth-msg').classList.add('hidden');
  }));

  $('form-signup').addEventListener('submit', async (e) => {
    e.preventDefault(); busy(e.target, true);
    try { const r = await api('/signup', 'POST', { firstName: $('s-first').value, lastName: $('s-last').value, email: $('s-email').value, password: $('s-pw').value }); authMsg(r.message, true); e.target.reset(); }
    catch (err) { authMsg(err.message); } finally { busy(e.target, false); }
  });
  $('form-forgot').addEventListener('submit', async (e) => {
    e.preventDefault(); busy(e.target, true);
    try { const r = await api('/forgot', 'POST', { email: $('f-email').value }); authMsg(r.message, true); }
    catch (err) { authMsg(err.message); } finally { busy(e.target, false); }
  });
  $('form-login').addEventListener('submit', async (e) => {
    e.preventDefault(); busy(e.target, true);
    try {
      const result = await api('/login', 'POST', { id: $('l-id').value, password: $('l-pw').value }); $('l-pw').value = '';
      if (result.requiresApproval || result.requiresPin) {
        activeLoginChallenge = result.challenge; loginApproved = !result.requiresApproval; loginNeedsPin = !!result.requiresPin;
        $('form-login').classList.add('hidden'); $('form-login-pin').classList.remove('hidden');
        $('form-login-pin').querySelector('label').classList.toggle('hidden', !loginNeedsPin);
        const continueButton = $('form-login-pin').querySelector('button[type="submit"],button:not([type])');
        continueButton.hidden = !loginNeedsPin; continueButton.disabled = loginNeedsPin && !loginApproved;
        $('login-step-message').textContent = result.message || 'Complete the sign-in check to continue.';
        if (result.requiresApproval) pollLoginChallenge();
      } else await start(true);
    }
    catch (err) { authMsg(err.message); } finally { busy(e.target, false); }
  });
  function resetLoginStep() {
    clearTimeout(loginPollTimer); loginPollTimer = null; activeLoginChallenge = ''; loginApproved = false; loginNeedsPin = false;
    $('form-login-pin').classList.add('hidden'); $('form-login').classList.remove('hidden'); $('l-pin').value = '';
  }
  $('cancel-login-step').addEventListener('click', (event) => { event.preventDefault(); resetLoginStep(); });
  async function pollLoginChallenge() {
    if (!activeLoginChallenge) return;
    try {
      const state = await api('/login-challenge', 'POST', { challenge: activeLoginChallenge });
      loginApproved = state.approved === true;
      if (state.complete) { resetLoginStep(); await start(true); return; }
      if (loginApproved && loginNeedsPin) {
        const continueButton = $('form-login-pin').querySelector('button[type="submit"],button:not([type])');
        continueButton.hidden = false; continueButton.disabled = false;
        $('login-step-message').textContent = 'Sign-in approved. Enter your six-digit PIN to continue.';
      } else if (!loginApproved) $('login-step-message').textContent = 'Approval email sent. Open its link; this page will continue automatically.';
    } catch (error) { resetLoginStep(); authMsg(error.message); return; }
    loginPollTimer = setTimeout(pollLoginChallenge, 3000);
  }
  $('form-login-pin').addEventListener('submit', async (event) => {
    event.preventDefault(); if (!activeLoginChallenge || !loginApproved) return;
    busy(event.target, true);
    try { await api('/login-pin', 'POST', { challenge: activeLoginChallenge, pin: $('l-pin').value }); resetLoginStep(); await start(true); }
    catch (error) { authMsg(error.message); } finally { busy(event.target, false); }
  });
  $('logout').addEventListener('click', async () => { if (!confirm('Are you sure you want to log out?')) return; await api('/logout', 'POST').catch(() => {}); me = null; showAuth(); });
  $('welcome-continue').addEventListener('click', () => $('welcome-screen').classList.add('hidden'));
  $('theme-choice').value = savedTheme;
  $('theme-choice').addEventListener('change', (event) => { savedTheme = event.target.value; try { localStorage.setItem('aipfa_theme', savedTheme); } catch { /* storage blocked */ } applyTheme(savedTheme); });
  $('form-profile').addEventListener('submit', async (event) => {
    event.preventDefault(); const file = $('profile-file').files?.[0];
    if (!file) { toast([{ text: 'Choose a profile picture first.' }]); return; }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1024 * 1024) { toast([{ text: 'Choose a PNG, JPEG, or WebP image up to 1 MB.' }]); return; }
    try {
      const avatar = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read that image.')); reader.readAsDataURL(file); });
      await api('/profile', 'POST', { avatar }); $('profile-picture').src = avatar; $('profile-picture').classList.remove('hidden'); $('profile-file').value = ''; toast([{ text: 'Profile picture saved.' }]);
    } catch (error) { toast([{ text: error.message }]); }
  });
  $('remove-profile-picture').addEventListener('click', async () => {
    try { await api('/profile', 'POST', { avatar: null }); $('profile-picture').removeAttribute('src'); $('profile-picture').classList.add('hidden'); toast([{ text: 'Profile picture removed.' }]); }
    catch (error) { toast([{ text: error.message }]); }
  });
  $('form-recovery-email').addEventListener('submit', async (event) => {
    event.preventDefault();
    try { const result = await api('/recovery-email', 'POST', { email: $('recovery-email').value, password: $('recovery-password').value }); event.target.reset(); toast([{ text: result.message }]); }
    catch (error) { toast([{ text: error.message }]); }
  });
  $('form-promote-recovery').addEventListener('submit', async (event) => {
    event.preventDefault();
    try { const result = await api('/recovery-email/promote', 'POST', { password: $('promote-password').value }); event.target.reset(); toast([{ text: result.message }]); }
    catch (error) { toast([{ text: error.message }]); }
  });
  $('form-pin').addEventListener('submit', async (event) => {
    event.preventDefault();
    try { await api('/pin', 'POST', { enabled: true, pin: $('account-pin').value, password: $('pin-password').value }); $('account-pin').value = ''; $('pin-password').value = ''; me.hasPin = true; renderPinStatus(); toast([{ text: 'Login PIN enabled.' }]); }
    catch (error) { toast([{ text: error.message }]); }
  });
  $('disable-pin').addEventListener('click', async () => {
    const password = $('pin-password').value;
    try { await api('/pin', 'POST', { enabled: false, password }); $('account-pin').value = ''; $('pin-password').value = ''; me.hasPin = false; renderPinStatus(); toast([{ text: 'Login PIN disabled.' }]); }
    catch (error) { toast([{ text: error.message }]); }
  });
  function renderPinStatus() {
    $('pin-status').textContent = me?.hasPin ? 'PIN is on. A six-digit PIN is required after your password at every login.' : 'PIN is off. Set a six-digit PIN if you want an extra login check.';
    $('enable-pin').textContent = me?.hasPin ? 'Change PIN' : 'Enable PIN';
    $('disable-pin').classList.toggle('hidden', !me?.hasPin);
  }

  // ----- tabs -----
  document.querySelectorAll('#tabs button').forEach((button) => button.addEventListener('click', () => activateTab(button.dataset.tab)));
  $('dashboard-ai-open').addEventListener('click', () => {
    activateTab('assistant');
    $('chat-input').focus();
  });

  // ----- dashboard -----
  async function refreshAfterTransactionChange(periodStart) {
    const latestMe = await api('/me');
    me = { ...me, ...latestMe };
    selectedPeriodOverride = periodStart || null;
    await refresh();
  }

  async function refresh() {
    const sequence = ++refreshSequence;
    const selectedPeriod = periodForMonth($('month').value);
    const s = await api('/summary?periodStart=' + encodeURIComponent(selectedPeriod));
    if (sequence !== refreshSequence) return;
    $('k-budget').textContent = usd(s.budget);
    $('k-income').textContent = usd(s.openingBalance + s.income);
    $('k-spent').textContent = usd(s.spent);
    $('k-savings').textContent = usd(s.totalSavings);
    const balance = Number.isFinite(s.balance) ? s.balance : s.income - s.spent;
    $('k-left').textContent = usd(balance);
    if (s.previousMonth) {
      const prevSpent = s.previousMonth.spent;
      const selectedMonthSpent = Number(s.spent || 0);
      const delta = selectedMonthSpent - prevSpent;
      const sofar = s.isCurrent ? ` so far (day ${s.dayNum} of ${s.daysInMonth})` : '';
      $('month-comparison').textContent = delta === 0
        ? `${s.month} and ${s.previousMonth.month}: spending is unchanged at ${usd(selectedMonthSpent)}.`
        : `${s.month}: ${usd(selectedMonthSpent)} spent${sofar} · ${s.previousMonth.month}: ${usd(prevSpent)} spent · ${usd(Math.abs(delta))} ${delta > 0 ? 'more' : 'less'} than ${s.previousMonth.month}. (Savings are not counted as spending.)`;
      if (monthComparison) monthComparison.destroy();
      monthComparison = new Chart($('month-comparison-chart'), {
        type: 'line',
        data: {
          labels: [s.previousMonth.month, s.month],
          datasets: [{ label: 'Expenses', data: [prevSpent, selectedMonthSpent], borderColor: '#2563eb', backgroundColor: '#2563eb', pointBackgroundColor: ['#64748b', '#2563eb'], pointRadius: 6, pointHoverRadius: 8, tension: 0.25, fill: false }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { callback: (value) => '$' + Number(value).toLocaleString('en-US') } } },
        },
      });
    } else {
      $('month-comparison').textContent = 'No previous-month data yet.';
      if (monthComparison) { monthComparison.destroy(); monthComparison = null; }
    }
    $('k-left').classList.toggle('neg', balance < 0);
    const pct = s.budget ? Math.max(0, Math.min((s.spent / s.budget) * 100, 100)) : 0;
    $('bar').style.width = pct + '%';
    $('bar').style.background = pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warn)' : 'var(--good)';
    $('bar-text').textContent = s.budget ? `${pct.toFixed(0)}% of ${s.month} budget used` : 'No budget set for this month yet.';
    $('budget-info').textContent = s.budget ? `${s.month} (${s.daysInMonth} days) · Monthly budget: ${usd(s.budget)} · Daily budget: ${usd(s.dailyBudget)} · Spent: ${usd(s.spent)} · Budget left: ${usd(s.remaining)} · Saved this month: ${usd(s.saved)} · Available balance: ${usd(balance)}` : `No monthly budget set. Available income: ${usd(balance)}`;

    const cats = Object.entries(s.byCat).sort((a, b) => b[1] - a[1]);
    if (pie) pie.destroy();
    pie = new Chart($('pie'), { type: 'doughnut', data: { labels: cats.map((c) => c[0]), datasets: [{ data: cats.map((c) => c[1]), backgroundColor: COLORS }] }, options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } } });

    const dates = Array.from({ length: s.daysInMonth }, (_, i) => {
      const [year, month, day] = s.start.split('-').map(Number);
      return new Date(Date.UTC(year, month - 1, day + i)).toISOString().slice(0, 10);
    });
    if (line) line.destroy();
    line = new Chart($('line'), {
      type: 'bar',
      data: { labels: dates.map((date) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))), datasets: [{ label: 'Spent', data: dates.map((date) => s.byDay[date] || 0), backgroundColor: '#2563eb' }] },
      options: { maintainAspectRatio: false, plugins: { legend: { display: false } } },
    });

    const tbl = $('cat-table'); tbl.replaceChildren();
    cats.forEach(([c, v]) => { const tr = el('tr'); tr.append(el('td', c), el('td', usd(v), 'amt'), el('td', s.spent ? ((v / s.spent) * 100).toFixed(0) + '%' : '', 'amt')); tbl.append(tr); });
    if (!cats.length) { const tr = el('tr'); tr.append(el('td', 'No expenses yet.')); tbl.append(tr); }

    s.insights.forEach((insight) => addNotification({
      id: `insight:${s.periodStart}:${insight.level}:${insight.text}`,
      title: insight.level === 'danger' ? 'Action needed' : insight.level === 'warn' ? 'Budget advice' : insight.level === 'good' ? 'Good progress' : 'Finance update',
      text: insight.text, level: insight.level,
    }));
    const ul = $('insights'); ul.replaceChildren();
    s.insights.forEach((i) => ul.append(el('li', normalizeCurrencyText(i.text), i.level)));
    if (s.budget && s.recommendation && s.recommendation.prioritize)
      ul.append(el('li', `With ${usd(s.recommendation.remaining)} left, prioritize: ${s.recommendation.prioritize.join(', ')}. Hold back on: ${s.recommendation.limit.join(', ')}.` + (s.recommendation.saveTarget > 0 ? ` Move ${usd(s.recommendation.saveTarget)} to Savings to reach the 20% goal.` : ''), 'info'));

    let allTransactions;
    try { allTransactions = await api('/transactions'); }
    catch { allTransactions = s.transactions || []; }
    if (sequence !== refreshSequence) return;
    const tt = $('tx-table'); tt.replaceChildren();
    const head = el('tr'); ['Date', 'Category', 'Note', 'Amount', ''].forEach((h) => head.append(el('th', h))); tt.append(head);
    const historyPeriod = periodForMonth($('tx-month').value || $('month').value);
    const historyBounds = cycleBounds(me.accountStart, historyPeriod);
    const historyLabel = periodLabel(historyBounds.start, historyBounds.end);
    $('tx-history-title').textContent = `History · ${historyLabel}`;
    const periodTransactions = allTransactions.filter((t) => t.date >= historyBounds.start && t.date <= historyBounds.end);
    periodTransactions.forEach((t) => {
      const tr = el('tr');
      const isSave = t.type === 'expense' && t.category === 'Savings';
      const amt = el('td', (t.type === 'income' ? '+' : isSave ? '→ ' : '-') + usd(t.amount), 'amt'); amt.style.color = t.type === 'income' ? 'var(--good)' : isSave ? 'var(--brand)' : 'inherit';
      const del = el('button', '✕', 'del'); del.title = 'Delete'; del.addEventListener('click', async () => {
        del.disabled = true;
        try { await api('/transactions/' + t.id, 'DELETE'); await refreshAfterTransactionChange(); }
        catch (err) { toast([{ text: err.message }]); del.disabled = false; }
      });
      const dtd = el('td'); dtd.append(del);
      tr.append(el('td', t.date), el('td', t.category), el('td', t.note || ''), amt, dtd); tt.append(tr);
    });
    if (!periodTransactions.length) {
      const tr = el('tr'); const empty = el('td', `No transactions recorded for ${historyLabel}.`, 'muted'); empty.colSpan = 5; tr.append(empty); tt.append(tr);
    }
  }
  function syncSelectedMonth(monthValue) {
    if (!monthValue) return;
    selectedPeriodOverride = null;
    $('month').value = monthValue; $('tx-month').value = monthValue;
    const { start, end } = cycleBounds(me.accountStart, periodForMonth(monthValue));
    const currentDate = $('t-date').value;
    if (currentDate < start || currentDate > end) $('t-date').value = start;
  }
  $('month').addEventListener('change', () => { syncSelectedMonth($('month').value); refresh(); });
  $('tx-month').addEventListener('change', () => { syncSelectedMonth($('tx-month').value); refresh(); });
  $('t-date').addEventListener('change', () => {
    if (!$('t-date').value) return;
    const date = $('t-date').value;
    const anchor = !me.hasIncome && $('t-type').value === 'income' ? date : me.accountStart;
    selectedPeriodOverride = cycleStartForDate(anchor, date);
    const month = selectedPeriodOverride.slice(0, 7);
    $('month').value = month; $('tx-month').value = month; refresh();
  });

  // ----- forms -----
  $('t-type').addEventListener('change', () => ($('t-cat').disabled = $('t-type').value === 'income'));
  $('form-tx').addEventListener('submit', async (e) => {
    e.preventDefault(); busy(e.target, true);
    try {
      const r = await api('/transactions', 'POST', { type: $('t-type').value, amount: $('t-amount').value, category: $('t-cat').value, note: $('t-note').value, date: $('t-date').value });
      me.accountStart = r.accountStart || me.accountStart;
      me.hasAccountingStart = true;
      me.hasIncome = me.hasIncome || $('t-type').value === 'income';
      me.currentPeriod = r.currentPeriod || me.currentPeriod;
      selectedPeriodOverride = r.transactionPeriod || cycleStartForDate(me.accountStart, $('t-date').value);
      const month = selectedPeriodOverride.slice(0, 7);
      $('month').value = month; $('tx-month').value = month;
      $('t-amount').value = ''; $('t-note').value = '';
      (r.advice || r.insights || []).forEach((item) => addNotification({ title: item.level === 'danger' ? 'Action needed' : item.level === 'warn' ? 'Budget advice' : 'Transaction update', text: item.text, level: item.level }));
      showAdvice(r.advice || r.insights); toast(r.advice || r.insights); await refresh();
    } catch (err) { toast([{ text: err.message }]); } finally { busy(e.target, false); }
  });
  $('budget-suggest').addEventListener('click', async () => {
    try { const s = await api('/summary?periodStart=' + encodeURIComponent(periodForMonth($('month').value))); const base = s.income > 0 ? s.income : Math.max(Number(s.openingBalance) || 0, 0); const monthly = Math.round(base * 0.5); $('b-total').value = monthly; $('b-daily').value = Math.round(monthly / s.daysInMonth); toast([{ text: s.income ? 'Suggested budgets use 50% of this month’s recorded income.' : base > 0 ? 'No income is recorded this month; the suggestion uses 50% of your carried-over balance.' : 'No income or carried-over balance is available for a budget suggestion.' }]); } catch (err) { toast([{ text: err.message }]); }
  });
  $('form-budget').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/budget', 'POST', { total: $('b-total').value, dailyTotal: $('b-daily').value, month: periodForMonth($('month').value) }); $('b-total').value = ''; $('b-daily').value = ''; toast([{ text: 'Budget saved.' }]); refresh(); }
    catch (err) { toast([{ text: err.message }]); }
  });
  $('form-pw').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('/change-password', 'POST', { current: $('p-cur').value, next: $('p-new').value }); e.target.reset(); toast([{ text: 'Password changed.' }]); }
    catch (err) { toast([{ text: err.message }]); }
  });

  $('ai-data-sharing').addEventListener('change', async (e) => {
    const control = e.currentTarget;
    if (control.checked && !confirm('I consent to sending finance context from AI chat and any selected bill image to this app’s configured AI provider. Continue?')) {
      control.checked = false;
      return;
    }
    control.disabled = true;
    try {
      const r = await api('/privacy', 'POST', { aiDataSharing: control.checked });
      control.checked = r.aiDataSharing;
      toast([{ text: r.aiDataSharing ? 'AI data processing is enabled.' : 'AI data processing is disabled. Local dashboard and reports remain available.' }]);
    } catch (err) { control.checked = !control.checked; toast([{ text: err.message }]); }
    finally { control.disabled = false; }
  });

  $('bill-scan').addEventListener('click', async () => {
    const file = $('bill-image').files?.[0];
    if (!file) { $('bill-result').textContent = 'Choose a bill image first.'; return; }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024) {
      $('bill-result').textContent = 'Choose a JPEG, PNG, or WebP image under 4 MB.'; return;
    }
    const button = $('bill-scan'); button.disabled = true; $('bill-result').textContent = 'Analyzing…';
    try {
      const image = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read that image.')); reader.readAsDataURL(file);
      });
      const r = await api('/bill/analyze', 'POST', { image, mimeType: file.type });
      $('t-type').value = 'expense'; $('t-cat').disabled = false;
      $('t-amount').value = r.amount; $('t-cat').value = r.category; $('t-note').value = r.vendor ? `${r.vendor} bill` : 'Bill'; $('t-date').value = r.date;
      const amountLabel = r.currency === 'USD' ? `USD $${r.amount.toFixed(2)}` : `${r.originalAmount} ${r.currency} ≈ USD $${r.amount.toFixed(2)}`;
      $('bill-result').textContent = `Suggested: ${amountLabel} · ${r.vendor || 'Unknown vendor'} · ${r.date}${r.dueDate ? ` · due ${r.dueDate}` : ''}. Non-USD values use an estimated live rate. Review and press Add transaction to save.`;
    } catch (err) { $('bill-result').textContent = err.message; }
    finally { button.disabled = false; }
  });

  // ----- chat -----
  // Plain text only; lines like "📎 label: /api/assistant/report?..." become download links.
  const FILE_LINE = /^📎 (.{1,140}?): (\/api\/assistant\/report\?[A-Za-z0-9=&_.%-]+)$/;
  function setBubbleText(b, text) {
    b.replaceChildren();
    const lines = String(text).split('\n');
    lines.forEach((line, i) => {
      const m = line.match(FILE_LINE);
      if (m) { const a = el('a', '⬇ ' + m[1]); a.href = m[2]; a.setAttribute('download', ''); a.style.fontWeight = '600'; b.append(a); }
      else b.append(document.createTextNode(line));
      if (i < lines.length - 1) b.append(document.createTextNode('\n'));
    });
  }
  $('chat-log').addEventListener('click', async (event) => {
    const link = event.target.closest('a[href*="/api/assistant/report?"]');
    if (!link || new URL(link.href).searchParams.get('format') !== 'xlsx') return;
    event.preventDefault();
    try {
      const response = await fetch(link.href, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || `Excel download failed (HTTP ${response.status}).`);
      }
      const type = response.headers.get('content-type') || '';
      if (!type.includes('spreadsheetml.sheet')) throw new Error('The server did not return an Excel workbook. Please try again.');
      const blob = await response.blob();
      if (!blob.size) throw new Error('The Excel report was empty. Please try again.');
      const disposition = response.headers.get('content-disposition') || '';
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'AIPFA-finance-report.xlsx';
      const objectUrl = URL.createObjectURL(blob);
      const download = document.createElement('a');
      download.href = objectUrl; download.download = filename; download.hidden = true;
      document.body.append(download); download.click(); download.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch (error) { toast([{ text: error.message }]); }
  });
  function bubble(role, text) { const b = el('div', '', 'bubble ' + role); setBubbleText(b, text); $('chat-log').append(b); $('chat-log').scrollTop = 1e9; return b; }
  async function loadChat() {
    const log = $('chat-log'); log.replaceChildren();
    const h = await api('/chat').catch(() => []);
    if (!h.length) bubble('assistant', 'Hi! I am your finance assistant. Ask me for your budget summary, tell me what you spent, or ask where to spend what is left.');
    h.forEach((m) => bubble(m.role, m.content));
  }
  let chatSending = false;
  let chatAttachment = null;
  const chatFile = $('chat-file'), chatFileName = $('chat-file-name');
  function clearChatAttachment() {
    chatAttachment = null; chatFile.value = ''; chatFileName.textContent = '';
    chatFileName.classList.add('hidden'); $('chat-file-remove').classList.add('hidden');
  }
  $('chat-attach').addEventListener('click', () => chatFile.click());
  $('chat-file-remove').addEventListener('click', clearChatAttachment);
  chatFile.addEventListener('change', () => {
    const file = chatFile.files && chatFile.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { clearChatAttachment(); toast([{ text: 'Choose a file smaller than 5 MB.' }]); return; }
    chatAttachment = file; chatFileName.textContent = file.name; chatFileName.title = file.name;
    chatFileName.classList.remove('hidden'); $('chat-file-remove').classList.remove('hidden');
    if (!$('chat-input').value.trim()) $('chat-input').value = 'Please summarize this file and tell me what it contains.';
  });
  function fileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read that file. Please choose it again.'));
      reader.readAsDataURL(file);
    });
  }
  $('form-chat').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (chatSending) return;
    const msg = $('chat-input').value.trim(); if (!msg && !chatAttachment) return;
    const voiceInput = window.__aipfaVoiceNext === true; window.__aipfaVoiceNext = false; // set after microphone audio is transcribed
    const asksForText = /\b(?:reply|answer|respond|write|give|send|show|provide|tell)\b.{0,30}\b(?:in|as)\s+text\b|\btext[- ]only\b|\bwritten (?:reply|answer|response)\b|\bin writing\b|\btype it\b|\bwrite it\b|\bwithout voice\b|\bno voice\b|\b(?:don't|do not) speak\b/i.test(msg)
      && !/\b(?:not|don't|do not|never)\s+(?:in|as)\s+text\b/i.test(msg);
    const asksToHearVoice = /\b(hear (?:your|you)(?: voice)?|want to hear|listen to (?:you|your voice)|talk to me|speak to me|use your voice|give me (?:your )?voice|say it (?:out loud|aloud)|read (?:it|that|this) to me|voice (?:reply|response)|answer (?:me )?verbally|can you speak|speak (?:in|with) (?:your )?voice|voice please|voice e bolo|bolo (?:in )?voice)\b/i.test(msg);
    const viaVoice = voiceInput || (asksToHearVoice && !asksForText);
    chatSending = true;
    $('chat-input').value = ''; bubble('user', msg + (chatAttachment ? `\n📎 ${chatAttachment.name}` : '')); const wait = bubble('assistant', '…'); busy(e.target, true);
    try {
      const attachment = chatAttachment ? { name: chatAttachment.name, mimeType: chatAttachment.type, dataUrl: await fileAsDataUrl(chatAttachment) } : null;
      const r = await api('/chat', 'POST', { message: msg, voice: viaVoice, ...(attachment ? { attachment } : {}) });
      setBubbleText(wait, r.reply); $('chat-log').scrollTop = 1e9;
      window.dispatchEvent(new CustomEvent('aipfa:reply', { detail: { text: r.reply, voice: viaVoice || r.voice === true, voiceInput } }));
      if (attachment) clearChatAttachment();
    }
    catch (err) { wait.textContent = '⚠ ' + err.message; } finally { busy(e.target, false); chatSending = false; }
  });
  $('chat-clear').addEventListener('click', async (e) => {
    const button = e.currentTarget, oldText = button.textContent;
    button.disabled = true; button.textContent = 'Clearing…';
    try { await api('/chat', 'DELETE'); const log = $('chat-log'); log.replaceChildren(); bubble('assistant', 'Hi! I am your AIPFA finance assistant. Ask me for your budget summary or spending advice.'); toast([{ text: 'Chat history cleared.' }]); }
    catch (err) { toast([{ text: err.message }]); } finally { button.disabled = false; button.textContent = oldText; }
  });
  $('form-delete-account').addEventListener('submit', async (e) => {
    e.preventDefault(); if (!confirm('Permanently delete your account and all its data? This cannot be undone.')) return;
    const button = e.target.querySelector('button'); button.disabled = true;
    try { await api('/account', 'DELETE', { password: $('delete-password').value }); me = null; showAuth(); authMsg('Your account and data have been deleted.', true); }
    catch (err) { toast([{ text: err.message }]); } finally { button.disabled = false; }
  });

  // ----- boot -----
  async function start(showWelcome = false) {
    me = await api('/me');
    initNotifications(me.loginId);
    $('a-email').textContent = me.email; $('a-id').textContent = me.loginId;
    $('a-name').textContent = `${me.firstName || ''} ${me.lastName || ''}`.trim() || 'AIPFA user'; $('a-username').textContent = me.username || '—';
    $('a-recovery-email').textContent = me.recoveryEmail || 'Not set'; $('form-promote-recovery').classList.toggle('hidden', !me.recoveryEmail); renderPinStatus();
    $('theme-choice').value = savedTheme; applyTheme(savedTheme);
    try { const profile = await api('/profile'); if (profile.avatar) { $('profile-picture').src = profile.avatar; $('profile-picture').classList.remove('hidden'); } else { $('profile-picture').classList.add('hidden'); $('profile-picture').removeAttribute('src'); } } catch { /* profile picture is optional */ }
    $('ai-data-sharing').checked = me.aiDataSharing !== false;
    $('t-cat').replaceChildren(...me.categories.map((c) => { const o = el('option', c); o.value = c; return o; }));
    const now = new Date();
    const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const currentMonth = localDate.slice(0, 7);
    selectedPeriodOverride = me.currentPeriod;
    $('month').value = currentMonth; $('tx-month').value = currentMonth;
    $('t-date').value = localDate;
    $('auth').classList.add('hidden'); $('app').classList.remove('hidden');
    if (showWelcome) { $('welcome-name').textContent = `Welcome, ${me.firstName || me.username || 'AIPFA user'}!`; $('welcome-screen').classList.remove('hidden'); }
      await refreshAfterTransactionChange(selectedPeriodOverride);
  }
  (async () => {
    const q = new URLSearchParams(location.search);
    try { await start(); } catch { showAuth(); $('form-login').classList.remove('hidden'); }
    if (q.has('verified')) { authMsg(q.get('verified') === '1' ? 'Email confirmed! Log in with your username or login ID and password.' : 'That confirmation link is invalid or already used.', q.get('verified') === '1'); history.replaceState({}, '', '/'); }
    if (q.has('deviceApproved')) { authMsg(q.get('deviceApproved') === '1' ? 'Sign-in approved. Return to the device where you started logging in.' : 'That sign-in approval link is invalid or expired.', q.get('deviceApproved') === '1'); history.replaceState({}, '', '/'); }
    if (q.has('recoveryEmail')) { authMsg(q.get('recoveryEmail') === '1' ? 'Recovery email verified. You may now use it for account recovery.' : 'Recovery email link is invalid or expired.', q.get('recoveryEmail') === '1'); history.replaceState({}, '', '/'); }
    if (q.has('emailChanged')) { authMsg(q.get('emailChanged') === '1' ? 'Email changed. Log in with your existing ID and new email.' : 'Email change link is invalid, expired, or already in use.', q.get('emailChanged') === '1'); history.replaceState({}, '', '/'); }
  })();
})();
