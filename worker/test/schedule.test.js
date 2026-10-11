const test = require('node:test');
const assert = require('node:assert');
const { dueSlots } = require('../src/schedule');

const iso = (slots) => slots.map((s) => `${s.kind}@${new Date(s.at).toISOString()}`);

test('daily Shorts at local times in the profile timezone', () => {
  const profile = { timezone: 'Asia/Kolkata', shorts: { enabled: true, times: ['07:00', '19:30'] } };
  const from = Date.parse('2026-10-11T00:00:00Z');
  const to = Date.parse('2026-10-12T00:00:00Z');
  assert.deepStrictEqual(iso(dueSlots(profile, from, to)), ['short@2026-10-11T01:30:00.000Z', 'short@2026-10-11T14:00:00.000Z']);
});

test('at most 3 Shorts a day', () => {
  const profile = { timezone: 'UTC', shorts: { enabled: true, times: ['01:00', '02:00', '03:00', '04:00'] } };
  assert.strictEqual(dueSlots(profile, Date.parse('2026-10-11T00:00:00Z'), Date.parse('2026-10-11T23:59:00Z')).length, 3);
});

test('long episodes on the chosen weekdays, given as numbers (dashboard) or names', () => {
  const from = Date.parse('2026-10-10T00:00:00Z'); // Saturday
  const to = Date.parse('2026-10-17T00:00:00Z');
  for (const days of [[0, 3], ['sun', 'wed']]) {
    const profile = { timezone: 'Asia/Kolkata', long: { enabled: true, days, time: '18:00' } };
    assert.deepStrictEqual(iso(dueSlots(profile, from, to)), ['long@2026-10-11T12:30:00.000Z', 'long@2026-10-14T12:30:00.000Z']);
  }
});

test('disabled schedules produce nothing', () => {
  const profile = { shorts: { enabled: false, times: ['07:00'] }, long: { enabled: false, days: [0, 1, 2, 3, 4, 5, 6], time: '07:00' } };
  assert.deepStrictEqual(dueSlots(profile, 0, Date.parse('2026-10-20T00:00:00Z')), []);
});

test('daylight saving time keeps the local wall-clock time', () => {
  const profile = { timezone: 'America/New_York', shorts: { enabled: true, times: ['09:00'] } };
  const out = iso(dueSlots(profile, Date.parse('2026-10-31T00:00:00Z'), Date.parse('2026-11-03T00:00:00Z')));
  assert.deepStrictEqual(out, ['short@2026-10-31T13:00:00.000Z', 'short@2026-11-01T14:00:00.000Z', 'short@2026-11-02T14:00:00.000Z']);
});

test('the window is exclusive at the start, so consecutive runs never double-post', () => {
  const profile = { timezone: 'UTC', shorts: { enabled: true, times: ['10:00'] } };
  const at = Date.parse('2026-10-11T10:00:00Z');
  assert.strictEqual(dueSlots(profile, at - 3600e3, at).length, 1);
  assert.strictEqual(dueSlots(profile, at, at + 3600e3).length, 0);
});
