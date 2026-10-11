/**
 * Which posts are due for a profile between two instants, in the profile's
 * own timezone:
 *   shorts: { enabled, times: ['07:00', '19:30'] }          (every day)
 *   long:   { enabled, days: [1, 4], time: '18:00' }      (0 = Sunday; 'mon' also accepted)
 * Returns [{ kind: 'short' | 'long', at: <ms> }] with from < at <= to.
 */
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MAX_SHORTS_PER_DAY = 3;

function partsIn(ms, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { y: +parts.year, m: +parts.month, d: +parts.day, h: +parts.hour, mi: +parts.minute, s: +parts.second,
    weekday: parts.weekday.toLowerCase().slice(0, 3) };
}

/** Epoch ms of a wall-clock time in `timeZone` (handles DST via one correction pass). */
function zonedToUtc(y, m, d, h, mi, timeZone) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const offset = (ms) => {
    const p = partsIn(ms, timeZone);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - ms;
  };
  const first = guess - offset(guess);
  return guess - offset(first);
}

function parseTime(t) {
  const m = String(t || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return [+m[1], +m[2]];
}

function dueSlots(profile, fromMs, toMs) {
  const timeZone = profile.timezone || 'Asia/Kolkata';
  const slots = [];
  // Every local calendar day the window touches (plus margin for offsets).
  for (let ms = fromMs - 36 * 3600e3; ms <= toMs + 36 * 3600e3; ms += 24 * 3600e3) {
    const { y, m, d } = partsIn(ms, timeZone);
    const dayNum = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    const add = (kind, time) => {
      const hm = parseTime(time);
      if (!hm) return;
      const at = zonedToUtc(y, m, d, hm[0], hm[1], timeZone);
      if (at > fromMs && at <= toMs && !slots.some((s) => s.kind === kind && s.at === at)) slots.push({ kind, at });
    };
    if (profile.shorts?.enabled) (profile.shorts.times || []).slice(0, MAX_SHORTS_PER_DAY).forEach((t) => add('short', t));
    if (profile.long?.enabled && (profile.long.days || []).some((x) => x === dayNum || x === DAYS[dayNum])) add('long', profile.long.time);
  }
  return slots.sort((a, b) => a.at - b.at);
}

module.exports = { dueSlots, zonedToUtc, partsIn, DAYS };
