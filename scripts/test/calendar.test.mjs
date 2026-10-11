// Checks the computed market calendar against the NYSE's published 2026–2028 calendars.
// Run: node scripts/test/calendar.test.mjs
import assert from 'node:assert/strict';
import {
  marketHolidays,
  marketEarlyCloses,
  marketStatus,
  etToMs,
  etParts,
  thirdFriday,
} from '../../functions/_shared/marketCalendar.ts';

const published = {
  2026: {
    holidays: ['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25'],
    early: ['2026-11-27', '2026-12-24'],
  },
  2027: {
    holidays: ['2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24'],
    early: ['2027-11-26'],
  },
  2028: {
    holidays: ['2028-01-17', '2028-02-21', '2028-04-14', '2028-05-29', '2028-06-19', '2028-07-04', '2028-09-04', '2028-11-23', '2028-12-25'],
    early: ['2028-07-03', '2028-11-24'],
  },
};

for (const [year, want] of Object.entries(published)) {
  assert.deepEqual([...marketHolidays(Number(year)).keys()].sort(), want.holidays, `holidays ${year}`);
  assert.deepEqual([...marketEarlyCloses(Number(year)).keys()].sort(), want.early, `early closes ${year}`);
}

// Daylight saving: 9:30 ET is 13:30 UTC in summer and 14:30 UTC in winter.
assert.equal(new Date(etToMs(2026, 7, 1, 570)).toISOString(), '2026-07-01T13:30:00.000Z');
assert.equal(new Date(etToMs(2026, 12, 1, 570)).toISOString(), '2026-12-01T14:30:00.000Z');
assert.equal(etParts(Date.UTC(2026, 9, 12, 13, 30)).minutes, 570);

const at = (iso) => marketStatus(Date.parse(iso));
// Sunday 11 Oct 2026: closed, opens Monday 9:30 ET.
let s = at('2026-10-11T09:20:00Z');
assert.equal(s.state, 'closed');
assert.equal(s.reason, 'Weekend');
assert.equal(new Date(s.nextOpen).toISOString(), '2026-10-12T13:30:00.000Z');
// Monday mid-session.
s = at('2026-10-12T15:00:00Z');
assert.equal(s.state, 'open');
assert.equal(new Date(s.closesAt).toISOString(), '2026-10-12T20:00:00.000Z');
// Monday pre-market and after-hours.
assert.equal(at('2026-10-12T12:00:00Z').state, 'pre');
assert.equal(at('2026-10-12T21:00:00Z').state, 'post');
assert.equal(at('2026-10-13T01:00:00Z').state, 'closed');
// Thanksgiving, then the 1:00 pm close on Friday.
s = at('2026-11-26T16:00:00Z');
assert.equal(s.reason, 'Thanksgiving Day');
s = at('2026-11-27T17:00:00Z');
assert.equal(s.state, 'open');
assert.equal(new Date(s.closesAt).toISOString(), '2026-11-27T18:00:00.000Z');
assert.equal(at('2026-11-27T18:30:00Z').state, 'post');
// Friday evening: next open is Monday.
assert.equal(new Date(at('2026-10-17T02:00:00Z').nextOpen).toISOString(), '2026-10-19T13:30:00.000Z');

assert.equal(thirdFriday(2026, 10), '2026-10-16');
assert.equal(thirdFriday(2026, 12), '2026-12-18');

console.log('calendar: all checks passed');
