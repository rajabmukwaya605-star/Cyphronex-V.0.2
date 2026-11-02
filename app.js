// Cyphronex-Bluevane: one module shared by chats / groups / channels / statuses / profile pages.
import { CONFIG } from './config.js';

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const h = (t, a = {}, ...c) => {
  const e = document.createElement(t);
  for (const [k, v] of Object.entries(a || {})) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...c.flat(9).filter(x => x != null && x !== false));
  return e;
};
const uid = () => crypto.randomUUID();
const hm = d => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const safe = n => n.replace(/[^\w.\-]/g, '_');
const PAGE = document.body.dataset.page;
const KIND = { chats: 'direct', groups: 'group', channels: 'channel' };
const TITLE = { chats: 'Chats', groups: 'Groups', channels: 'Channels' };

/* ---------- themes ---------- */
// [name, accent, bg, surface, border, text, muted, my-bubble]
const TH = {
  stealth: ['Cyphron Stealth', '#00f0ff', '#070b14', '#0d1527', '#1e293b', '#f8fafc', '#94a3b8', '#0284c7'],
  neon: ['Electric Neon', '#00ffff', '#0a0a12', '#141226', '#2e2652', '#ffffff', '#a5b4fc', '#ec4899'],
  matrix: ['Matrix Terminal', '#00ff66', '#020703', '#06160b', '#0e381d', '#e6fffa', '#86efac', '#059669'],
  midnight: ['Obsidian Amethyst', '#a855f7', '#0a0714', '#130d24', '#2e1e52', '#faf5ff', '#c084fc', '#7c3aed'],
  solar: ['Solar Flare', '#f59e0b', '#0f0c08', '#1c160e', '#3d301f', '#fffbeb', '#fcd34d', '#d97706'],
  ocean: ['Deep Abyss', '#38bdf8', '#040b17', '#08172e', '#173663', '#f0f9ff', '#7dd3fc', '#0284c7'],
  light: ['Crystal Clean', '#0284c7', '#f8fafc', '#ffffff', '#e2e8f0', '#0f172a', '#475569', '#0284c7'],
};
const lum = c => { const n = parseInt(c.slice(1), 16); return .299 * (n >> 16) + .587 * (n >> 8 & 255) + .114 * (n & 255); };
const getTheme = () => { try { return { id: 'stealth', custom: { accent: '#00f0ff', mode: 'dark', shape: 'cyber' }, ...JSON.parse(localStorage.cx_theme) }; } catch { return { id: 'stealth', custom: { accent: '#00f0ff', mode: 'dark', shape: 'cyber' } }; } };
function applyTheme(t = getTheme()) {
  let [, accent, bg, surf, bd, tx, mut, me] = TH[t.id] || TH.stealth;
  const c = t.custom || {};
  if (t.id === 'custom') {
    accent = me = c.accent || '#00f0ff';
    if (c.mode === 'light') [bg, surf, bd, tx, mut] = ['#f8fafc', '#ffffff', '#e2e8f0', '#0f172a', '#475569'];
    else [bg, surf, bd, tx, mut] = TH.stealth.slice(2, 7);
  }
  const shape = { rounded: ['18px 18px 4px 18px', '18px 18px 18px 4px'], minimal: ['6px', '6px'], cyber: ['12px 2px 12px 12px', '2px 12px 12px 12px'] }[c.shape || 'cyber'];
  const vars = { accent, bg, surf, bd, tx, mut, me, onme: lum(me) > 150 ? '#070b14' : '#fff', onacc: lum(accent) > 150 ? '#070b14' : '#fff', rme: shape[0], rthem: shape[1] };
  for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty('--' + k, v);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', bg);
}
applyTheme();

/* ---------- end-to-end encryption (ECDH P-256 -> AES-256-GCM), direct chats ---------- */
const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const EC = { name: 'ECDH', namedCurve: 'P-256' };
let mine, sharedKeys = {};
async function keys() {
  if (mine) return mine;
  let s = localStorage.getItem('cx_ecdh');
  if (!s) {
    const k = await crypto.subtle.generateKey(EC, true, ['deriveKey']);
    s = JSON.stringify({ priv: await crypto.subtle.exportKey('jwk', k.privateKey), pub: await crypto.subtle.exportKey('jwk', k.publicKey) });
    localStorage.setItem('cx_ecdh', s);
  }
  const o = JSON.parse(s);
  return (mine = { pub: JSON.stringify(o.pub), priv: await crypto.subtle.importKey('jwk', o.priv, EC, false, ['deriveKey']) });
}
async function sharedKey(pub) {
  if (sharedKeys[pub]) return sharedKeys[pub];
  const p = await crypto.subtle.importKey('jwk', JSON.parse(pub), EC, false, []);
  return (sharedKeys[pub] = await crypto.subtle.deriveKey({ name: 'ECDH', public: p }, (await keys()).priv, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
}
async function enc(text, pub) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sharedKey(pub), new TextEncoder().encode(text));
  return { body: b64(ct), iv: b64(iv) };
}
async function dec(m, pub) {
  try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(m.iv) }, await sharedKey(pub), unb64(m.body))); }
  catch { return '🔒 Can’t decrypt: sent with a different key (new device or reset browser data)'; }
}
async function fingerprint(pub) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pub)));
  return [...d.slice(0, 16)].map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase().match(/.{4}/g).join(' ');
}

/* ---------- backend: Supabase when configured, otherwise a local demo store ---------- */
let sb = null, demo = true, L = null, me = null, P = {}, installEv = null;
const LS = 'cx_demo_v1';
const save = () => localStorage.setItem(LS, JSON.stringify(L));
const cfg = () => ({
  url: (localStorage.cx_url || CONFIG.SUPABASE_URL || '').trim().replace(/\/rest\/v1\/?$/, '').replace(/\/$/, ''),
  key: (localStorage.cx_anon || CONFIG.SUPABASE_ANON_KEY || '').trim(),
});
async function initBackend() {
  const { url, key } = cfg();
  if (localStorage.cx_mode === 'demo' || !url.startsWith('http') || !key) return;
  try {
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.45.4');
    sb = createClient(url, key);
    demo = false;
  } catch (e) { console.warn('Supabase unavailable, using demo mode', e); }
}
const subs = {}, chans = {};
const db = {
  async list(t, f = {}) {
    if (sb) {
      let q = sb.from(t).select('*');
      for (const [k, v] of Object.entries(f)) q = Array.isArray(v) ? q.in(k, v) : q.eq(k, v);
      const { data, error } = await q; if (error) throw error; return data;
    }
    return L[t].filter(r => Object.entries(f).every(([k, v]) => Array.isArray(v) ? v.includes(r[k]) : r[k] === v));
  },
  async add(t, row) {
    if (sb) { const { data, error } = await sb.from(t).insert(row).select().single(); if (error) throw error; return data; }
    const r = { id: uid(), created_at: new Date().toISOString(), ...row };
    L[t].push(r); save(); (subs[t] || []).forEach(f => f(r)); return r;
  },
  async set(t, id, patch) {
    if (sb) { const { error } = await sb.from(t).update(patch).eq('id', id); if (error) throw error; return; }
    Object.assign(L[t].find(r => r.id === id), patch); save();
  },
  async del(t, id) {
    if (sb) { const { error } = await sb.from(t).delete().eq('id', id); if (error) throw error; return; }
    L[t] = L[t].filter(r => r.id !== id); save();
  },
  on(t, f) {
    (subs[t] ||= []).push(f);
    if (sb && !chans[t]) chans[t] = sb.channel('rt_' + t).on('postgres_changes', { event: 'INSERT', schema: 'public', table: t }, p => subs[t].forEach(g => g(p.new))).subscribe();
  },
};
async function upFile(bucket, path, f) {
  const meta = { name: f.name || path.split('/').pop(), type: f.type, size: f.size };
  if (sb) {
    const { error } = await sb.storage.from(bucket).upload(path, f, { contentType: f.type });
    if (error) throw error;
    return { url: sb.storage.from(bucket).getPublicUrl(path).data.publicUrl, ...meta };
  }
  if (f.size > 1.5e6) throw new Error('Demo mode keeps files in this browser: 1.5 MB max. Connect Supabase for larger files.');
  return new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok({ url: r.result, ...meta }); r.onerror = no; r.readAsDataURL(f); });
}
const shrink = (f, n) => new Promise((ok, no) => {
  const i = new Image();
  i.onload = () => { const c = document.createElement('canvas'), s = Math.min(1, n / Math.max(i.width, i.height)); c.width = i.width * s; c.height = i.height * s; c.getContext('2d').drawImage(i, 0, 0, c.width, c.height); c.toBlob(ok, 'image/jpeg', .85); };
  i.onerror = () => no(new Error('That file isn’t a readable image.')); i.src = URL.createObjectURL(f);
});

function seed() {
  const t = o => new Date(Date.now() - o).toISOString();
  const pr = (id, username, display_name, bio) => ({ id, username, display_name, bio, avatar_url: null, status: 'online', public_key: null, theme_preference: null });
  const cv = (id, type, name, by, description = '') => ({ id, type, name, description, created_by: by, created_at: t(1e7) });
  const pt = (c, u, role = 'member') => ({ id: uid(), conversation_id: c, user_id: u, role });
  const ms = (c, s, body, o) => ({ id: uid(), conversation_id: c, sender_id: s, body, iv: null, attachment: null, created_at: t(o) });
  const st = (user_id, content, bg, o) => ({ id: uid(), user_id, kind: 'text', content, bg, media_url: null, created_at: t(o), expires_at: new Date(Date.now() + 864e5 - o).toISOString() });
  return {
    profiles: [pr('me', 'operator', 'Operator Zero', 'Secured by Cyphronex-Bluevane'), pr('elena', 'elena_v', 'Elena Vance', 'Quantum cryptography researcher'), pr('marcus', 'marcus_k', 'Marcus K.', 'Hardware security engineer')],
    conversations: [cv('c1', 'direct', null, 'me'), cv('g1', 'group', 'Bluevane Ops', 'me'), cv('ch1', 'channel', 'Bluevane News', 'elena', 'Release notes and announcements')],
    participants: [pt('c1', 'me', 'owner'), pt('c1', 'elena'), pt('g1', 'me', 'owner'), pt('g1', 'elena'), pt('g1', 'marcus'), pt('ch1', 'elena', 'owner'), pt('ch1', 'me')],
    messages: [ms('c1', 'elena', 'Hey! Welcome to Cyphronex-Bluevane 👋', 6e5), ms('g1', 'marcus', 'Firmware build deployed. All good.', 3e6), ms('ch1', 'elena', 'Channels, groups, statuses and the installable app are live.', 9e6)],
    statuses: [st('elena', 'Shipping day 🚀', '#7c3aed', 36e5), st('marcus', 'Cold storage audit done ✅', '#0f766e', 72e5)],
  };
}
async function loadProfiles() { P = Object.fromEntries((await db.list('profiles')).map(p => [p.id, p])); }

/* ---------- ui pieces ---------- */
const COLORS = ['#7c3aed', '#0f766e', '#be123c', '#0369a1', '#b45309', '#334155'];
function avatar(p, cls = '') {
  p = p || { display_name: '?' };
  if (p.avatar_url) return h('img', { class: 'av ' + cls, src: p.avatar_url, alt: '' });
  const n = (p.display_name || p.name || '?').trim();
  return h('div', { class: 'av ' + cls, style: `background:hsl(${[...n].reduce((a, c) => a + c.charCodeAt(0), 0) * 47 % 360} 55% 38%)` }, n[0].toUpperCase());
}
function modal(title, fields, ok, label = 'Create') {
  const err = h('p', { class: 'err' });
  const ins = fields.map(f => h(f.area ? 'textarea' : 'input', { placeholder: f.label, 'aria-label': f.label, required: f.req, type: f.type }));
  const close = () => { d.close(); d.remove(); };
  const d = h('dialog', {}, h('form', {
    class: 'dlg', onsubmit: async e => { e.preventDefault(); try { await ok(ins.map(i => i.value.trim())); close(); } catch (x) { err.textContent = x.message; } },
  }, h('h3', {}, title), ...ins, err, h('div', { class: 'acts' }, h('button', { type: 'button', class: 'btn ghost', onclick: close }, 'Cancel'), h('button', { class: 'btn' }, label))));
  document.body.append(d); d.showModal(); ins[0].focus();
}
function shell() {
  const N = [['chats', '💬', 'Chats'], ['groups', '👥', 'Groups'], ['channels', '📢', 'Channels'], ['statuses', '⭕', 'Status'], ['profile', '🙂', 'Profile']];
  document.body.replaceChildren(h('div', { class: 'app' },
    h('nav', { 'aria-label': 'Main' }, ...N.map(([p, i, l]) => h('a', { href: p + '.html', class: p === PAGE ? 'on' : '', 'aria-current': p === PAGE ? 'page' : null }, h('span', {}, i), l))),
    h('main', { id: 'main' })));
}
function authScreen() {
  const msg = h('p', { class: 'err' }), f = n => $('[name=' + n + ']');
  const go = async up => {
    msg.textContent = '';
    const email = f('email').value.trim(), password = f('pw').value, name = f('name').value.trim();
    if (!email || !password) return msg.textContent = 'Enter your email and password.';
    if (up) {
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { display_name: name || undefined, username: name.toLowerCase().replace(/[^a-z0-9_]/g, '') || undefined } } });
      if (error) return msg.textContent = error.message;
      if (!data.session) return msg.textContent = 'Account created. Confirm the email we sent, then sign in.';
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return msg.textContent = error.message;
    }
    location.reload();
  };
  document.body.replaceChildren(h('div', { class: 'auth' },
    h('h1', {}, 'Cyphronex-Bluevane'), h('p', { class: 'mut' }, 'Sign in to your encrypted workspace.'),
    h('input', { name: 'name', placeholder: 'Display name (new accounts)', autocomplete: 'name' }),
    h('input', { name: 'email', type: 'email', placeholder: 'Email', autocomplete: 'email' }),
    h('input', { name: 'pw', type: 'password', placeholder: 'Password', autocomplete: 'current-password' }),
    msg, h('button', { class: 'btn', onclick: () => go(false) }, 'Sign in'),
    h('button', { class: 'btn ghost', onclick: () => go(true) }, 'Create account'),
    h('button', { class: 'btn ghost', onclick: () => { localStorage.cx_mode = 'demo'; location.reload(); } }, 'Try offline demo')));
}

/* ---------- chats / groups / channels (one implementation, three pages) ---------- */
async function chatPage() {
  const kind = KIND[PAGE], main = $('#main');
  let convs = [], parts = [], mineIds = new Set(), peers = {}, cur = null, addMsg = null;
  const list = h('div', { class: 'list' }), pane = h('section', { class: 'pane' }, h('div', { class: 'empty' }, 'Pick a conversation, or start a new one.'));
  main.append(list, pane);
  const title = c => kind === 'direct' ? (P[peers[c.id]]?.display_name || 'Unknown contact') : c.name;
  const sub = c => kind === 'direct' ? (P[peers[c.id]]?.bio || '') : (c.description || '');

  async function load() {
    parts = await db.list('participants', { user_id: me.id }); mineIds = new Set(parts.map(p => p.conversation_id));
    const all = await db.list('conversations', { type: kind });
    convs = kind === 'channel' ? all : all.filter(c => mineIds.has(c.id));
    peers = {}; const ids = convs.map(c => c.id);
    if (kind === 'direct' && ids.length) for (const p of await db.list('participants', { conversation_id: ids })) if (p.user_id !== me.id) peers[p.conversation_id] = p.user_id;
    await loadProfiles(); renderList();
  }
  function renderList() {
    list.replaceChildren(
      h('header', {}, h('h2', {}, TITLE[PAGE]), demo ? h('span', { class: 'chip' }, 'demo') : null, h('button', { class: 'btn sm', onclick: newDlg }, '＋ New')),
      ...(convs.length ? convs.map(c => h('div', { class: 'row' + (cur?.id === c.id ? ' on' : ''), tabindex: 0, onclick: () => pick(c), onkeydown: e => e.key === 'Enter' && pick(c) },
        avatar(kind === 'direct' ? P[peers[c.id]] : c), h('div', { class: 'grow' }, h('b', {}, title(c)), h('small', {}, sub(c))),
        kind === 'channel' && !mineIds.has(c.id) ? h('button', { class: 'btn sm' }, 'Join') : null)) : [h('p', { class: 'mut pad' }, 'Nothing here yet. Use “New” to create one.')]));
  }
  async function pick(c) {
    try {
      if (kind === 'channel' && !mineIds.has(c.id)) { await db.add('participants', { conversation_id: c.id, user_id: me.id, role: 'member' }); await load(); }
      open(c);
    } catch (e) { alert(e.message); }
  }
  async function mk(type, name, desc, members) {
    const c = await db.add('conversations', { type, name: name || null, description: desc || null, created_by: me.id });
    await db.add('participants', { conversation_id: c.id, user_id: me.id, role: 'owner' });
    for (const u of members) await db.add('participants', { conversation_id: c.id, user_id: u, role: 'member' });
    await load(); open(convs.find(x => x.id === c.id));
  }
  const byUser = async u => { const [p] = await db.list('profiles', { username: u.replace(/^@/, '').toLowerCase() }); if (!p) throw new Error(`No user named “${u}”.`); return p; };
  function newDlg() {
    const hint = demo ? ' (demo: elena_v, marcus_k)' : '';
    if (kind === 'direct') modal('New chat', [{ label: 'Their username' + hint, req: true }], async ([u]) => {
      const p = await byUser(u); if (p.id === me.id) throw new Error('That’s your own username.');
      const ex = convs.find(c => peers[c.id] === p.id); if (ex) return open(ex);
      await mk('direct', null, '', [p.id]);
    }, 'Start chat');
    else if (kind === 'group') modal('New group', [{ label: 'Group name', req: true }, { label: 'Members’ usernames, comma separated' + hint }], async ([n, m]) => {
      const ids = []; for (const u of m.split(',').map(x => x.trim()).filter(Boolean)) ids.push((await byUser(u)).id);
      await mk('group', n, '', [...new Set(ids)].filter(i => i !== me.id));
    });
    else modal('New channel', [{ label: 'Channel name', req: true }, { label: 'What is this channel for?', area: true }], ([n, d]) => mk('channel', n, d, []));
  }
  async function open(c) {
    cur = c; const seen = new Set(); history.replaceState(null, '', '#' + c.id); document.body.classList.add('open'); renderList();
    const role = parts.find(p => p.conversation_id === c.id)?.role, canPost = c.type !== 'channel' || ['owner', 'admin'].includes(role);
    const peer = c.type === 'direct' ? P[peers[c.id]] : null;
    const useE2E = !demo && peer?.public_key && me.public_key;
    const box = h('div', { class: 'msgs' });
    addMsg = async m => {
      if (seen.has(m.id)) return; seen.add(m.id);
      const text = m.iv && peer?.public_key ? await dec(m, peer.public_key) : m.body, a = m.attachment, mineMsg = m.sender_id === me.id;
      box.append(h('div', { class: 'msg' + (mineMsg ? ' me' : '') }, h('div', { class: 'bub' },
        !mineMsg && c.type !== 'direct' ? h('div', { class: 'who' }, P[m.sender_id]?.display_name || 'Member') : null,
        a ? (a.type?.startsWith('image/') ? h('img', { src: a.url, alt: a.name }) : h('a', { class: 'file', href: a.url, target: '_blank', rel: 'noopener', download: a.name }, '📄 ' + a.name + ' (' + Math.max(1, Math.round(a.size / 1024)) + ' KB)')) : null,
        text || null, h('div', { class: 'time' }, (m.iv ? '🔒 ' : '') + hm(m.created_at)))));
      box.scrollTop = box.scrollHeight;
    };
    const send = async (text, f) => {
      try {
        const row = { conversation_id: c.id, sender_id: me.id, body: text, iv: null, attachment: null };
        if (f) row.attachment = await upFile('attachments', `${c.id}/${uid()}-${safe(f.name)}`, f);
        if (text && useE2E) Object.assign(row, await enc(text, peer.public_key));
        addMsg(await db.add('messages', row));
        if (demo && c.type !== 'channel') {
          const others = L.participants.filter(p => p.conversation_id === c.id && p.user_id !== me.id);
          if (others.length) setTimeout(() => db.add('messages', { conversation_id: c.id, sender_id: others[0].user_id, body: ['Got it 👍', 'Noted. Verified on my side.', 'Sounds good, sending details shortly.'][Math.random() * 3 | 0], iv: null, attachment: null }), 1200);
        }
      } catch (e) { alert(e.message); }
    };
    const inp = h('input', { placeholder: 'Write a message', autocomplete: 'off', 'aria-label': 'Message' });
    const file = h('input', { type: 'file', hidden: true, onchange: () => { if (file.files[0]) { send(inp.value.trim(), file.files[0]); inp.value = ''; } file.value = ''; } });
    pane.replaceChildren(
      h('header', {}, h('button', { class: 'ib back', 'aria-label': 'Back', onclick: () => { document.body.classList.remove('open'); history.replaceState(null, '', location.pathname); } }, '←'),
        avatar(peer || c), h('div', { class: 'grow' }, h('h3', {}, title(c)), h('small', {}, c.type === 'direct' ? (useE2E ? '🔒 End-to-end encrypted' : 'Not end-to-end encrypted yet') : (c.description || c.type)))),
      box,
      canPost ? h('form', { class: 'comp', onsubmit: e => { e.preventDefault(); const t = inp.value.trim(); if (t) { inp.value = ''; send(t); } } },
        h('button', { type: 'button', class: 'ib', title: 'Share a file', 'aria-label': 'Share a file', onclick: () => file.click() }, '📎'), inp, file, h('button', { class: 'btn' }, 'Send'))
        : h('div', { class: 'notice' }, 'Only channel admins can post here.'));
    const msgs = (await db.list('messages', { conversation_id: c.id })).sort((a, b) => a.created_at < b.created_at ? -1 : 1);
    for (const m of msgs) await addMsg(m);
  }
  db.on('messages', m => { if (cur && m.conversation_id === cur.id) addMsg?.(m); });
  await load();
  const want = location.hash.slice(1), c = convs.find(x => x.id === want); if (c) open(c);
}

/* ---------- statuses ---------- */
async function statusPage() {
  await loadProfiles();
  let bg = COLORS[0];
  const ta = h('textarea', { placeholder: 'Share a status that disappears in 24 hours', maxlength: 280, 'aria-label': 'Status text' });
  const prev = h('div', { class: 'scard', style: `background:${bg}` }, ta);
  const fi = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: () => { if (fi.files[0]) prev.style.backgroundImage = `url(${URL.createObjectURL(fi.files[0])})`; } });
  const mineBox = h('div', { class: 'grid' }), othersBox = h('div', { class: 'grid' });
  const post = async () => {
    try {
      const f = fi.files[0], t = ta.value.trim(); if (!t && !f) return;
      const media = f ? (await upFile('attachments', `status/${me.id}/${uid()}-${safe(f.name)}`, f)).url : null;
      await db.add('statuses', { user_id: me.id, kind: f ? 'image' : 'text', content: t, bg, media_url: media, expires_at: new Date(Date.now() + 864e5).toISOString() });
      ta.value = ''; fi.value = ''; prev.style.backgroundImage = ''; refresh();
    } catch (e) { alert(e.message); }
  };
  const card = s => h('div', { class: 'scard', style: `background:${s.bg || '#334155'}${s.media_url ? ` center/cover url("${s.media_url}")` : ''}` },
    h('div', { class: 'by' }, avatar(P[s.user_id]), h('span', {}, (s.user_id === me.id ? 'You' : P[s.user_id]?.display_name || 'Member') + ' · ' + hm(s.created_at)),
      s.user_id === me.id ? h('button', { class: 'ib', style: 'margin-left:auto', title: 'Delete status', 'aria-label': 'Delete status', onclick: async () => { await db.del('statuses', s.id); refresh(); } }, '🗑') : null),
    s.content ? h('p', {}, s.content) : null);
  async function refresh() {
    const all = (await db.list('statuses')).filter(s => new Date(s.expires_at) > new Date()).sort((a, b) => a.created_at < b.created_at ? 1 : -1);
    const m = all.filter(s => s.user_id === me.id), o = all.filter(s => s.user_id !== me.id);
    mineBox.replaceChildren(...(m.length ? m.map(card) : [h('p', { class: 'mut' }, 'You haven’t posted a status in the last 24 hours.')]));
    othersBox.replaceChildren(...(o.length ? o.map(card) : [h('p', { class: 'mut' }, 'No updates from your contacts right now.')]));
  }
  $('#main').append(h('div', { class: 'page' },
    h('section', {}, h('h2', {}, 'Status'), h('div', { class: 'grid' }, prev),
      h('div', { class: 'tools' }, ...COLORS.map(c => h('button', { type: 'button', class: 'sw', style: `background:${c}`, 'aria-label': 'Background ' + c, onclick: () => { bg = c; prev.style.background = c; fi.value = ''; prev.style.backgroundImage = ''; } })),
        h('button', { class: 'btn ghost sm', onclick: () => fi.click() }, '🖼 Add photo'), fi, h('button', { class: 'btn sm', onclick: post }, 'Post status'))),
    h('section', {}, h('h3', {}, 'Your statuses'), mineBox), h('section', {}, h('h3', {}, 'Recent updates'), othersBox)));
  db.on('statuses', refresh); await refresh();
}

/* ---------- profile, themes, backend, install ---------- */
async function profilePage() {
  const k = await keys(), fp = await fingerprint(k.pub), cur = getTheme();
  const name = h('input', { value: me.display_name || '' }), bio = h('textarea', {}, me.bio || '');
  const stat = h('select', {}, ...['online', 'busy', 'away'].map(s => h('option', { value: s, selected: (me.status || 'online') === s }, s)));
  const avBox = h('div', {}, avatar(me, 'lg'));
  const pic = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => {
    try {
      const blob = await shrink(pic.files[0], 256), r = await upFile('avatars', `${me.id}/avatar-${Date.now()}.jpg`, blob);
      await db.set('profiles', me.id, { avatar_url: r.url }); me.avatar_url = r.url; avBox.replaceChildren(avatar(me, 'lg'));
    } catch (e) { alert(e.message); }
  } });
  const saved = h('small', { class: 'mut' });
  const saveProfile = async () => {
    try { const p = { display_name: name.value.trim() || me.display_name, bio: bio.value.trim(), status: stat.value }; await db.set('profiles', me.id, p); Object.assign(me, p); saved.textContent = 'Saved.'; }
    catch (e) { saved.textContent = e.message; }
  };
  const setTheme = async t => {
    localStorage.cx_theme = JSON.stringify(t); applyTheme(t);
    if (!demo) try { await db.set('profiles', me.id, { theme_preference: t }); } catch { /* theme still saved locally */ }
    drawThemes();
  };
  const themeBox = h('div', {}), customBox = h('div', { class: 'line', style: 'margin-top:12px' });
  function drawThemes() {
    const t = getTheme();
    themeBox.replaceChildren(h('div', { class: 'themes' }, ...Object.entries(TH).map(([id, v]) => h('button', { class: 'theme' + (t.id === id ? ' on' : ''), onclick: () => setTheme({ ...t, id }) },
      h('i', {}, ...[v[2], v[3], v[1], v[7]].map(c => h('b', { style: `background:${c}` })), ), h('span', {}, v[0])))));
    const acc = h('input', { type: 'color', value: t.custom.accent, style: 'width:56px;padding:2px', 'aria-label': 'Accent color' });
    const mode = h('select', {}, ...['dark', 'light'].map(m => h('option', { value: m, selected: t.custom.mode === m }, m + ' surfaces')));
    const shape = h('select', {}, ...['cyber', 'rounded', 'minimal'].map(m => h('option', { value: m, selected: t.custom.shape === m }, m + ' bubbles')));
    customBox.replaceChildren(h('b', {}, 'Custom'), acc, mode, shape, h('button', { class: 'btn sm', onclick: () => setTheme({ id: 'custom', custom: { accent: acc.value, mode: mode.value, shape: shape.value } }) }, 'Apply custom'));
  }
  drawThemes();
  const { url } = cfg(), u = h('input', { placeholder: 'https://<project>.supabase.co', value: localStorage.cx_url || '' }), a = h('input', { placeholder: 'anon / publishable key', value: localStorage.cx_anon || '' });
  const installBtn = h('button', { class: 'btn', onclick: async () => { if (installEv) { installEv.prompt(); installEv = null; installBtn.hidden = true; } } }, 'Install app');
  installBtn.hidden = !installEv; window.addEventListener('beforeinstallprompt', () => { installBtn.hidden = false; });
  $('#main').append(h('div', { class: 'page' }, h('h2', {}, 'Profile'),
    h('section', { class: 'form' }, h('div', { class: 'line' }, avBox, h('button', { class: 'btn ghost sm', onclick: () => pic.click() }, 'Change photo'), pic),
      h('label', {}, 'Display name', name), h('label', {}, 'Bio', bio), h('label', {}, 'Status', stat),
      h('small', { class: 'mut' }, `@${me.username} · ${me.cyphron_tag || 'local profile'}`), h('small', { class: 'mut' }, 'Key fingerprint: ', h('code', {}, fp)),
      h('div', { class: 'line' }, h('button', { class: 'btn', onclick: saveProfile }, 'Save profile'), saved)),
    h('section', {}, h('h3', {}, 'Theme'), themeBox, customBox),
    h('section', { class: 'form' }, h('h3', {}, 'Backend'),
      h('p', { class: 'mut' }, demo ? 'Running in offline demo mode. Data stays in this browser.' : `Connected to Supabase: ${url}`),
      h('label', {}, 'Project URL', u), h('label', {}, 'Anon / publishable key', a),
      h('div', { class: 'line' }, h('button', { class: 'btn', onclick: () => { localStorage.cx_url = u.value.trim(); localStorage.cx_anon = a.value.trim(); delete localStorage.cx_mode; location.reload(); } }, 'Connect'),
        h('button', { class: 'btn ghost', onclick: () => { localStorage.cx_mode = 'demo'; location.reload(); } }, 'Use demo'),
        demo ? h('button', { class: 'btn ghost', onclick: () => { if (confirm('Reset demo data?')) { localStorage.removeItem(LS); location.reload(); } } }, 'Reset demo data')
          : h('button', { class: 'btn danger', onclick: async () => { await sb.auth.signOut(); location.reload(); } }, 'Sign out'))),
    h('section', { class: 'form' }, h('h3', {}, 'Install'), h('p', { class: 'mut' }, 'Chrome, Edge and Android: use Install. iPhone and iPad: Share, then Add to Home Screen.'), installBtn)));
}

/* ---------- boot ---------- */
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEv = e; });
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
(async function boot() {
  await initBackend();
  if (sb) {
    const { data } = await sb.auth.getSession();
    if (!data.session) return authScreen();
    let p; for (let i = 0; i < 5 && !p; i++) { [p] = await db.list('profiles', { id: data.session.user.id }); if (!p) await new Promise(r => setTimeout(r, 400)); }
    if (!p) { document.body.textContent = 'Profile not found. Did you run schema.sql?'; return; }
    me = p; const k = await keys();
    if (me.public_key !== k.pub) { await db.set('profiles', me.id, { public_key: k.pub, key_fingerprint: await fingerprint(k.pub) }); me.public_key = k.pub; }
    if (me.theme_preference?.id) { localStorage.cx_theme = JSON.stringify(me.theme_preference); applyTheme(); }
  } else {
    try { L = JSON.parse(localStorage.getItem(LS)); } catch { L = null; }
    L ||= seed(); save(); me = L.profiles.find(p => p.id === 'me');
    addEventListener('storage', e => { // keep two open tabs in sync
      if (e.key !== LS || !e.newValue) return;
      const old = L; L = JSON.parse(e.newValue);
      for (const t of Object.keys(subs)) L[t].filter(r => !old[t].some(o => o.id === r.id)).forEach(r => subs[t].forEach(f => f(r)));
    });
  }
  shell();
  await ({ chats: chatPage, groups: chatPage, channels: chatPage, statuses: statusPage, profile: profilePage })[PAGE]();
})();
