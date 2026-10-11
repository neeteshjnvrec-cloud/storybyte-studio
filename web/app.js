import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, query, orderBy, limit, addDoc, setDoc, deleteDoc, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (sel) => document.querySelector(sel);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PLATFORMS = { youtube: 'YouTube', facebook: 'Facebook', instagram: 'Instagram' };
const NICHES = Object.fromEntries([...document.querySelectorAll('select[name=niche] option')].map((o) => [o.value, o.textContent]));

let user = null;
let connections = [];
let profiles = [];
let editing = null; // profile id being edited, or 'new'
let unsubscribers = [];

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

function flash(message, kind = 'ok') {
  const box = $('#flash');
  box.textContent = message;
  box.className = `flash ${kind}`;
  box.hidden = false;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => { box.hidden = true; }, 8000);
}

async function api(path, body = {}) {
  const res = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `request failed (${res.status})`);
  return json;
}

// ---- Sign in ----
$('#sign-in').addEventListener('click', () => signInWithPopup(auth, new GoogleAuthProvider()).catch((e) => flash(e.message, 'error')));

onAuthStateChanged(auth, (u) => {
  user = u;
  unsubscribers.forEach((f) => f());
  unsubscribers = [];
  $('#signed-out').hidden = !!u;
  $('#signed-in').hidden = !u;
  $('#who').replaceChildren(...(u ? [el('span', {}, u.email), el('button', { class: 'ghost', onclick: () => signOut(auth) }, 'Sign out')] : []));
  if (!u) return;
  const base = `users/${u.uid}`;
  setDoc(doc(db, base), { email: u.email, lastSeenAt: serverTimestamp() }, { merge: true }).catch(() => {});
  unsubscribers.push(
    onSnapshot(collection(db, `${base}/connections`), (snap) => {
      connections = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderConnections();
      renderProfiles();
      if (editing) fillTargets();
    }),
    onSnapshot(collection(db, `${base}/profiles`), (snap) => {
      profiles = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderProfiles();
    }),
    onSnapshot(query(collection(db, `${base}/jobs`), orderBy('createdAt', 'desc'), limit(25)), (snap) => {
      renderJobs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }),
  );
});

// Result of an OAuth round trip (the callback redirects back with ?connected= or ?error=).
const params = new URLSearchParams(location.search);
if (params.get('connected')) flash(`Connected: ${params.get('connected')}`);
if (params.get('error')) flash(params.get('error'), 'error');
if (params.toString()) history.replaceState(null, '', location.pathname);

// ---- Connections ----
async function connect(platform) {
  try {
    const { url } = await api(`oauth/${platform}/start`);
    location.href = url;
  } catch (e) {
    flash(e.message, 'error');
  }
}
$('#connect-youtube').addEventListener('click', () => connect('youtube'));
$('#connect-meta').addEventListener('click', () => connect('meta'));

function renderConnections() {
  const list = $('#connections');
  if (!connections.length) {
    list.replaceChildren(el('li', { class: 'empty' }, 'Nothing connected yet.'));
    return;
  }
  list.replaceChildren(...connections
    .sort((a, b) => a.platform.localeCompare(b.platform) || a.name.localeCompare(b.name))
    .map((c) => el('li', {},
      el('span', { class: `tag ${c.platform}` }, PLATFORMS[c.platform]),
      el('span', { class: 'grow' }, c.name),
      c.status === 'expired'
        ? el('button', { class: 'warn', title: c.statusReason || '', onclick: () => connect(c.platform === 'youtube' ? 'youtube' : 'meta') }, 'Reconnect')
        : el('span', { class: 'ok' }, '● connected'),
      el('button', {
        class: 'ghost', title: 'Disconnect',
        onclick: async () => {
          if (!confirm(`Disconnect ${c.name}? Profiles posting to it will stop posting there.`)) return;
          try { await api('connections/delete', { id: c.id }); } catch (e) { flash(e.message, 'error'); }
        },
      }, '✕'))));
}

// ---- Profiles ----
function renderProfiles() {
  const list = $('#profiles');
  if (!profiles.length) {
    list.replaceChildren(el('li', { class: 'empty' }, 'No profiles yet — create one to start posting.'));
    return;
  }
  list.replaceChildren(...profiles.map((p) => {
    const where = Object.entries(p.targets || {}).map(([k, id]) => connections.find((c) => c.id === id) ? PLATFORMS[k] : null).filter(Boolean);
    const when = [
      p.shorts?.enabled && (p.shorts.times || []).length ? `Shorts ${p.shorts.times.join(', ')}` : null,
      p.long?.enabled && (p.long.days || []).length ? `Episodes ${p.long.days.map((d) => DAYS[d]).join('/')} ${p.long.time || ''}` : null,
    ].filter(Boolean);
    return el('li', {},
      el('span', { class: `dot ${p.active ? 'on' : ''}`, title: p.active ? 'Active' : 'Paused' }),
      el('span', { class: 'grow' },
        el('strong', {}, p.name || 'Untitled'),
        el('small', {}, [p.niche === 'custom' ? p.customNiche : NICHES[p.niche], p.language === 'hi' ? 'Hindi' : 'English', ...when,
          where.length ? `→ ${where.join(', ')}` : 'not posting anywhere yet'].filter(Boolean).join(' · '))),
      el('button', { onclick: () => openEditor(p.id) }, 'Edit'));
  }));
}

const form = $('#profile-form');
$('#long-days').replaceChildren(...DAYS.map((d, i) => el('label', { class: 'inline' }, el('input', { type: 'checkbox', name: `day${i}` }), d)));

function fillTargets() {
  const p = profiles.find((x) => x.id === editing) || {};
  for (const platform of Object.keys(PLATFORMS)) {
    const select = form.elements[`target_${platform}`];
    const current = select.value || p.targets?.[platform] || '';
    select.replaceChildren(el('option', { value: '' }, '— don\'t post —'),
      ...connections.filter((c) => c.platform === platform).map((c) => el('option', { value: c.id }, c.name)));
    select.value = connections.some((c) => c.id === current) ? current : '';
  }
}

function openEditor(id) {
  editing = id;
  const p = profiles.find((x) => x.id === id) || {
    name: '', niche: 'devotional', language: 'hi', style: 'cartoon3d', voice: 'female', active: true,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
    shorts: { enabled: true, times: ['07:00'] }, long: { enabled: false, days: [0], time: '18:00' }, targets: {},
  };
  const f = form.elements;
  for (const k of ['name', 'niche', 'customNiche', 'language', 'style', 'voice', 'timezone', 'footer']) f[k].value = p[k] || '';
  f.hashtags.value = (p.hashtags || []).join(' ');
  f.active.checked = !!p.active;
  f.shortsEnabled.checked = !!p.shorts?.enabled;
  [0, 1, 2].forEach((i) => { f[`shortTime${i}`].value = p.shorts?.times?.[i] || ''; });
  f.longEnabled.checked = !!p.long?.enabled;
  f.seriesTitle.value = p.long?.seriesTitle || '';
  f.longGenre.value = p.long?.genre || '';
  f.longTime.value = p.long?.time || '18:00';
  DAYS.forEach((_, i) => { f[`day${i}`].checked = (p.long?.days || []).includes(i); });
  for (const platform of Object.keys(PLATFORMS)) f[`target_${platform}`].value = '';
  fillTargets();
  for (const platform of Object.keys(PLATFORMS)) f[`target_${platform}`].value = connections.some((c) => c.id === p.targets?.[platform]) ? p.targets[platform] : '';
  toggleCustom();
  $('#editor-title').textContent = id === 'new' ? 'New profile' : `Edit “${p.name}”`;
  for (const b of ['#run-short', '#run-long', '#delete-profile']) $(b).hidden = id === 'new';
  $('#editor').hidden = false;
  $('#editor').scrollIntoView({ behavior: 'smooth' });
}

function toggleCustom() {
  document.querySelector('.custom-niche').hidden = form.elements.niche.value !== 'custom';
}
form.elements.niche.addEventListener('change', toggleCustom);

$('#new-profile').addEventListener('click', () => {
  if (profiles.length >= 3) return flash('You can have up to 3 profiles.', 'error');
  openEditor('new');
});
$('#close-editor').addEventListener('click', () => { editing = null; $('#editor').hidden = true; });

function readForm() {
  const f = form.elements;
  const timezone = f.timezone.value.trim();
  try { Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { throw new Error(`"${timezone}" is not a time zone — try e.g. Asia/Kolkata`); }
  const times = [0, 1, 2].map((i) => f[`shortTime${i}`].value).filter(Boolean);
  const days = DAYS.map((_, i) => (f[`day${i}`].checked ? i : null)).filter((d) => d !== null);
  if (f.niche.value === 'custom' && !f.customNiche.value.trim()) throw new Error('Describe your topic');
  const targets = Object.fromEntries(Object.keys(PLATFORMS).map((k) => [k, f[`target_${k}`].value]).filter(([, v]) => v));
  return {
    name: f.name.value.trim(), niche: f.niche.value, customNiche: f.customNiche.value.trim(), language: f.language.value,
    style: f.style.value, voice: f.voice.value, timezone, active: f.active.checked,
    shorts: { enabled: f.shortsEnabled.checked, times: [...new Set(times)] },
    long: { enabled: f.longEnabled.checked, days, time: f.longTime.value || '18:00', seriesTitle: f.seriesTitle.value.trim(), genre: f.longGenre.value.trim() },
    targets,
    hashtags: f.hashtags.value.split(/[\s,]+/).filter(Boolean).map((t) => (t.startsWith('#') ? t : `#${t}`)).slice(0, 15),
    footer: f.footer.value.trim(),
    updatedAt: serverTimestamp(),
  };
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const data = readForm();
    if (editing === 'new') {
      const ref = await addDoc(collection(db, `users/${user.uid}/profiles`), { ...data, createdAt: serverTimestamp() });
      editing = ref.id;
      for (const b of ['#run-short', '#run-long', '#delete-profile']) $(b).hidden = false;
    } else {
      await setDoc(doc(db, `users/${user.uid}/profiles/${editing}`), data);
    }
    flash(data.active && !Object.keys(data.targets).length ? 'Saved — pick at least one account under "Post to" to start posting.' : 'Saved.');
  } catch (err) {
    flash(err.message, 'error');
  }
});

$('#delete-profile').addEventListener('click', async () => {
  if (!confirm('Delete this profile? Already-published videos stay up.')) return;
  await deleteDoc(doc(db, `users/${user.uid}/profiles/${editing}`));
  editing = null;
  $('#editor').hidden = true;
});

for (const kind of ['short', 'long']) {
  $(`#run-${kind}`).addEventListener('click', async () => {
    try {
      await api('run-now', { profileId: editing, kind });
      flash(kind === 'short' ? 'Queued — your Short will start within the hour.' : 'Queued — the episode will start within the hour.');
    } catch (e) {
      flash(e.message, 'error');
    }
  });
}

// ---- Jobs ----
const STATUS = { queued: '⏳ queued', running: '🎬 making', done: '✅ published', failed: '⚠️ failed', skipped: '— skipped' };

function renderJobs(jobs) {
  const list = $('#jobs');
  if (!jobs.length) {
    list.replaceChildren(el('li', { class: 'empty' }, 'No videos yet.'));
    return;
  }
  list.replaceChildren(...jobs.map((j) => {
    const p = profiles.find((x) => x.id === j.profileId);
    const when = (j.finishedAt || j.startedAt || j.createdAt)?.toDate?.();
    const links = Object.entries(j.result?.results || {}).map(([k, r]) => (r.posted
      ? el('a', { href: r.url, target: '_blank', rel: 'noopener' }, PLATFORMS[k])
      : el('span', { class: 'bad', title: r.error || '' }, `${PLATFORMS[k]} ✗`)));
    return el('li', {},
      el('span', { class: `status ${j.status}` }, STATUS[j.status] || j.status),
      el('span', { class: 'grow' },
        el('strong', {}, j.result?.title || (j.kind === 'long' ? 'Episode' : 'Short')),
        el('small', {}, [p?.name, j.kind === 'long' ? 'episode' : 'Short', when?.toLocaleString(), j.error && j.status !== 'done' ? j.error : null]
          .filter(Boolean).join(' · '))),
      el('span', { class: 'links' }, links));
  }));
}
