import { decryptArchive } from './crypto.mjs';
const $ = id => document.getElementById(id);
const WORKSPACES = { 'paper-prisons': { name: 'Paper Prisons', mark: 'PP' }, 'tech-bono': { name: 'Tech Bono', mark: 'TB' } };
let slug, data, groups = new Map(), page = 1, generation = 0, lastActivity = Date.now();
const PAGE_SIZE = 40;
function node(tag, text, className) { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; }
const name = id => data.users[id] || id;
const channelName = id => data.channels[id] || id;
const clock = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
function wipe() {
  generation++; data = undefined; groups.clear(); page = 1;
  $('password').value = ''; $('username').value = ''; $('password').type = 'password'; $('show-password').textContent = 'Show'; $('show-password').setAttribute('aria-label', 'Show password');
  $('messages').replaceChildren(); $('thread-messages').replaceChildren(); $('thread-title').textContent = 'Conversation';
  $('filters').reset(); $('query').value = '';
  $('channel').replaceChildren(new Option('All public channels', '')); $('person').replaceChildren(new Option('Everyone', ''));
  for (const id of ['archive-title', 'archive-subtitle', 'archive-stat', 'workspace-label', 'last-checked', 'result-count', 'page-label']) $(id).textContent = '';
  if ($('thread').open) $('thread').close();
  $('archive').hidden = true; $('lock').hidden = true; $('login-status').textContent = ''; $('unlock').disabled = false; $('unlock').textContent = 'Unlock archive';
}
function home() { wipe(); slug = undefined; $('welcome').hidden = false; $('login').hidden = true; $('home').focus(); }
function choose(value) {
  if (!Object.hasOwn(WORKSPACES, value)) return;
  wipe(); slug = value; $('welcome').hidden = true; $('login').hidden = false;
  $('login-title').textContent = WORKSPACES[slug].name; $('login-mark').textContent = WORKSPACES[slug].mark; $('username').focus();
}
function validatePayload(p) {
  if (!p || p.version !== 1 || p.workspace !== slug || !Array.isArray(p.messages) || !p.channels || !p.users) throw new Error('Invalid archive');
  const seen = new Set();
  for (const m of p.messages) {
    if (typeof m.text !== 'string' || typeof m.user !== 'string' || typeof m.channel !== 'string' || !/^\d{10}\.\d{1,6}$/.test(m.ts) || !/^\d{10}\.\d{1,6}$/.test(m.thread_ts) || !/^\d{4}-\d{2}-\d{2}$/.test(m.day)) throw new Error('Invalid archive');
    const id = `${m.channel}/${m.ts}`; if (seen.has(id)) throw new Error('Invalid archive'); seen.add(id);
  }
  return p;
}
$('unlock-form').addEventListener('submit', async event => {
  event.preventDefault(); const attempt = ++generation, selected = slug, password = $('password').value, loginName = $('username').value;
  $('password').value = ''; $('unlock').disabled = true; $('unlock').textContent = 'Unlocking…'; $('login-status').textContent = '';
  let downloaded = false;
  try {
    if (!crypto?.subtle) throw new Error('Secure browser required');
    const response = await fetch(new URL(`./archives/${selected}.enc.json`, import.meta.url), { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error('Download failed');
    const text = await response.text(); if (text.length > 48_000_000) throw new Error('Archive too large'); downloaded = true;
    const payload = await decryptArchive(JSON.parse(text), selected, loginName, password);
    if (attempt !== generation || selected !== slug) return;
    data = validatePayload(payload); groups = new Map();
    for (const m of data.messages) { const key = `${m.channel}/${m.thread_ts}`, group = groups.get(key) || { parent: null, replies: [] }; if (m.ts === m.thread_ts) group.parent = m; else group.replies.push(m); groups.set(key, group); }
    for (const group of groups.values()) group.replies.sort((a, b) => a.ts.localeCompare(b.ts));
    for (const [id, label] of Object.entries(data.channels).sort((a, b) => a[1].localeCompare(b[1]))) $('channel').append(new Option(`# ${label}`, id));
    const authors = [...new Set(data.messages.map(m => m.user))].sort((a, b) => name(a).localeCompare(name(b)));
    for (const id of authors) $('person').append(new Option(name(id), id));
    $('workspace-label').textContent = WORKSPACES[slug].name;
    $('archive-stat').textContent = `${data.messages.length.toLocaleString()} saved messages · ${Object.keys(data.channels).length} ${Object.keys(data.channels).length === 1 ? 'channel' : 'channels'}`;
    if (data.lastChecked && Number.isFinite(Date.parse(data.lastChecked))) $('last-checked').textContent = `Last checked ${clock.format(new Date(data.lastChecked))} Pacific. Reload this page for newly published messages.`;
    $('login').hidden = true; $('archive').hidden = false; $('lock').hidden = false; lastActivity = Date.now(); render(); $('query').focus();
  } catch {
    if (attempt !== generation) return;
    $('login-status').textContent = downloaded ? 'That username and password did not unlock this archive. Please try again or contact your team administrator.' : 'This archive is unavailable right now. Please try again or contact your team administrator.';
  } finally { if (attempt === generation) { $('unlock').disabled = false; $('unlock').textContent = 'Unlock archive'; } }
});
function message(m, inThread = false) {
  const article = node('article', undefined, 'message'), body = node('div', undefined, 'message-body'), meta = node('div', undefined, 'message-meta');
  article.append(node('div', name(m.user).slice(0, 1).toUpperCase(), 'avatar')); article.lastChild.setAttribute('aria-hidden', 'true'); article.append(body);
  meta.append(node('strong', name(m.user))); const date = new Date(Number(m.ts.split('.')[0]) * 1000), time = node('time', clock.format(date)); time.dateTime = date.toISOString(); meta.append(time, node('span', `# ${channelName(m.channel)}`, 'channel-tag')); body.append(meta);
  if (!inThread && m.text.length > 900) { body.append(node('div', m.text.slice(0, 550) + '…', 'message-text')); const details = node('details'); details.append(node('summary', 'Read full message'), node('div', m.text, 'message-text')); body.append(details); }
  else body.append(node('div', m.text, 'message-text'));
  if (inThread) body.append(node('span', m.ts === m.thread_ts ? 'Original message' : 'Reply', 'reply-label'));
  else {
    const group = groups.get(`${m.channel}/${m.thread_ts}`), count = group?.replies.length || 0;
    const label = m.ts !== m.thread_ts ? 'Reply · View original and conversation →' : count ? `${count} ${count === 1 ? 'reply' : 'replies'} · View conversation →` : 'View conversation →';
    const button = node('button', label, 'conversation-link'); button.addEventListener('click', () => openThread(m)); body.append(button);
  }
  return article;
}
function openThread(m) {
  const group = groups.get(`${m.channel}/${m.thread_ts}`); if (!group) return;
  $('thread-title').textContent = `# ${channelName(m.channel)} · Conversation`; $('thread-messages').replaceChildren();
  if (group.parent) $('thread-messages').append(message(group.parent, true)); else $('thread-messages').append(node('p', 'The original message has not been saved in this archive.', 'muted'));
  for (const reply of group.replies) $('thread-messages').append(message(reply, true));
  $('thread').showModal();
}
function render() {
  if (!data) return;
  const q = $('query').value.trim().toLocaleLowerCase(), channel = $('channel').value, person = $('person').value, start = $('start').value, end = $('end').value, sort = $('sort').value;
  if (start && end && start > end) { $('result-count').textContent = 'Choose an end date on or after the start date.'; $('messages').replaceChildren(); $('pagination').hidden = true; return; }
  const timeline = !!channel && !q && !person && !start && !end;
  let rows = data.messages.filter(m => (!channel || m.channel === channel) && (!person || m.user === person) && (!start || m.day >= start) && (!end || m.day <= end) && (!q || m.text.toLocaleLowerCase().includes(q)));
  if (timeline) rows = rows.filter(m => { const g = groups.get(`${m.channel}/${m.thread_ts}`); return m.ts === m.thread_ts || (!g?.parent && g?.replies[0]?.ts === m.ts); });
  rows.sort((a, b) => { if (sort === 'person') { const d = name(a.user).localeCompare(name(b.user)); if (d) return d; } if (sort === 'channel') { const d = channelName(a.channel).localeCompare(channelName(b.channel)); if (d) return d; } return sort === 'oldest' ? a.ts.localeCompare(b.ts) : b.ts.localeCompare(a.ts); });
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE)); page = Math.max(1, Math.min(page, pages));
  $('archive-title').textContent = channel ? `# ${channelName(channel)}` : `${WORKSPACES[slug].name} archive`;
  $('archive-subtitle').textContent = timeline ? 'Browse channel conversations in time order.' : 'Search and browse saved public-channel messages.';
  const from = (page - 1) * PAGE_SIZE, to = Math.min(from + PAGE_SIZE, rows.length);
  $('result-count').textContent = rows.length ? `${from + 1}–${to} of ${rows.length.toLocaleString()} ${timeline ? 'conversations' : 'messages'}` : 'No matching messages';
  $('messages').replaceChildren(...rows.slice(from, to).map(m => message(m)));
  if (!rows.length) { const empty = node('div', undefined, 'empty'); empty.append(node('h2', 'No matching messages'), node('p', 'Try another word or adjust your filters.', 'muted')); $('messages').append(empty); }
  $('pagination').hidden = !rows.length; $('page-label').textContent = `Page ${page} of ${pages}`; $('previous').disabled = page === 1; $('next').disabled = page === pages;
}
$('filters').addEventListener('submit', e => { e.preventDefault(); page = 1; render(); });
$('channel').addEventListener('change', () => { $('sort').value = $('channel').value ? 'oldest' : 'newest'; page = 1; render(); });
$('reset').addEventListener('click', () => { $('filters').reset(); page = 1; render(); });
$('previous').addEventListener('click', () => { page--; render(); $('result-count').scrollIntoView({ block: 'nearest' }); });
$('next').addEventListener('click', () => { page++; render(); $('result-count').scrollIntoView({ block: 'nearest' }); });
for (const id of ['home', 'login-back', 'switch', 'lock']) $(id).addEventListener('click', home);
for (const button of document.querySelectorAll('[data-workspace]')) button.addEventListener('click', () => choose(button.dataset.workspace));
$('show-password').addEventListener('click', () => { const show = $('password').type === 'password'; $('password').type = show ? 'text' : 'password'; $('show-password').textContent = show ? 'Hide' : 'Show'; $('show-password').setAttribute('aria-label', show ? 'Hide password' : 'Show password'); });
$('close-thread').addEventListener('click', () => $('thread').close());
$('help').addEventListener('click', () => $('help-dialog').showModal()); $('close-help').addEventListener('click', () => $('help-dialog').close());
for (const event of ['pointerdown', 'keydown', 'wheel', 'touchstart']) document.addEventListener(event, () => { lastActivity = Date.now(); }, { passive: true });
setInterval(() => { if (data && Date.now() - lastActivity >= 15 * 60 * 1000) home(); }, 30_000);
window.addEventListener('pagehide', home);
