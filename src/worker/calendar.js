// Calendar events from one or more iCal (.ics) feeds, expanded (recurrences included) into a
// flat list for the next N days. Uses ical.js, which handles RRULE, EXDATE and RECURRENCE-ID.
import ICAL from 'ical.js';
import { zonedToUtc, zonedDateString, isValidTimeZone, addDays } from './time.js';
import { demoEvents } from './demo.js';

const MAX_OCCURRENCES_PER_SERIES = 5000;

export async function getEvents(calendarsJson, config) {
  const calendars = parseCalendars(calendarsJson);
  const now = Date.now();
  // Start of today in the home time zone, so events that already ended today still list.
  const today = zonedDateString(now, config.timezone);
  const rangeStart = zonedToUtc(today, '00:00', config.timezone);
  const rangeEnd = rangeStart + (config.calendarDays + 1) * 86400000;

  if (!calendars.length) {
    return { demo: true, events: demoEvents(config, today) };
  }

  const results = await Promise.allSettled(
    calendars.map((cal) => loadCalendar(cal, rangeStart, rangeEnd, config.timezone)),
  );

  const events = [];
  const errors = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') events.push(...r.value);
    else errors.push(`${calendars[i].name}: ${r.reason?.message || r.reason}`);
  });
  if (errors.length && !events.length) throw new Error(errors.join('; '));

  events.sort((a, b) => sortKey(a, config.timezone) - sortKey(b, config.timezone) || a.title.localeCompare(b.title));
  return { demo: false, events, errors };
}

function parseCalendars(raw) {
  if (!raw) return [];
  let text = typeof raw === 'string' ? raw.trim() : raw;
  // Tolerate the shell quotes from .dev.vars being pasted into `wrangler secret put`.
  if (typeof text === 'string' && /^(['"]).*\1$/s.test(text) && /^['"]\s*[[{]/.test(text)) {
    text = text.slice(1, -1).trim();
  }

  if (typeof text !== 'string' || /^[[{]/.test(text)) {
    let list;
    try {
      list = typeof text === 'string' ? JSON.parse(text) : text;
    } catch (err) {
      throw new Error(`CALENDARS is not valid JSON (${err.message})`);
    }
    return (Array.isArray(list) ? list : [list])
      .filter((c) => c && c.url)
      .map((c, i) => ({ name: c.name || `Calendar ${i + 1}`, color: c.color || '#81b29a', url: c.url }));
  }

  // Also allow a plain list of URLs separated by commas, spaces or newlines.
  return text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((url, i) => ({ name: `Calendar ${i + 1}`, color: '#81b29a', url }));
}

async function loadCalendar(cal, rangeStart, rangeEnd, homeZone) {
  const url = cal.url.replace(/^webcal:/i, 'https:');
  const res = await fetch(url, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();

  // Real feeds hold years of history. Workers get very little CPU per request (10 ms on the Free
  // plan), so drop events that can't reach the window before ical.js parses anything.
  const fromDay = compactDay(addDays(zonedDateString(rangeStart, 'UTC'), -2));
  const toDay = compactDay(addDays(zonedDateString(rangeEnd, 'UTC'), 2));
  const root = new ICAL.Component(ICAL.parse(prefilter(text, fromDay, toDay)));
  const calZone = root.getFirstPropertyValue('x-wr-timezone');

  // Group by UID so moved/cancelled single occurrences (RECURRENCE-ID) override the series.
  const masters = new Map();
  const exceptions = new Map();
  for (const vevent of root.getAllSubcomponents('vevent')) {
    const uid = vevent.getFirstPropertyValue('uid') || Math.random().toString(36);
    if (vevent.hasProperty('recurrence-id')) {
      if (!exceptions.has(uid)) exceptions.set(uid, []);
      exceptions.get(uid).push(vevent);
    } else {
      masters.set(uid, vevent);
    }
  }

  const out = [];
  const seen = new Set();

  for (const [uid, vevent] of masters) {
    const tzHint = pickZone(vevent.getFirstProperty('dtstart')?.getParameter('tzid'), calZone, homeZone);
    fastForward(vevent, rangeStart);
    const event = new ICAL.Event(vevent, { strictExceptions: false });
    for (const ex of exceptions.get(uid) || []) event.relateException(ex);

    if (!event.isRecurring()) {
      if (isCancelled(vevent)) continue;
      pushIfInRange(out, seen, cal, uid, event, event.startDate, event.endDate, tzHint, rangeStart, rangeEnd);
      continue;
    }

    // Cheap bounds first (unix time, padded a day for floating times); the exact, zone-aware
    // conversion only runs for occurrences near the window.
    const durMs = event.duration ? event.duration.toSeconds() * 1000 : 0;
    const lo = rangeStart - durMs - 86400000;
    const hi = rangeEnd + 86400000;
    const it = event.iterator();
    let next;
    let count = 0;
    while ((next = it.next()) && count++ < MAX_OCCURRENCES_PER_SERIES) {
      const approx = next.toUnixTime() * 1000;
      if (approx >= hi) break;
      if (approx < lo && !event.exceptions[next.toString()]) continue;
      const occ = event.getOccurrenceDetails(next);
      if (isCancelled(occ.item.component)) continue;
      pushIfInRange(out, seen, cal, uid, occ.item, occ.startDate, occ.endDate, tzHint, rangeStart, rangeEnd);
    }

    // An occurrence moved into the window from far away (outside what the loop walked).
    for (const ex of exceptions.get(uid) || []) {
      if (isCancelled(ex)) continue;
      const exEvent = new ICAL.Event(ex);
      pushIfInRange(out, seen, cal, uid, exEvent, exEvent.startDate, exEvent.endDate, tzHint, rangeStart, rangeEnd);
    }
  }
  return out;
}

const DAY_MS = 86400000;

/**
 * Move the DTSTART (and DTEND) of a long-running DAILY/WEEKLY/MONTHLY series without COUNT forward
 * by a whole number of periods, to just before the window, so ical.js doesn't walk years of
 * history. Occurrences keep their phase and wall-clock time; EXDATE, UNTIL and RECURRENCE-ID are
 * absolute, so they still match. The shifted DTSTART itself always lands outside the window.
 */
function fastForward(vevent, rangeStart) {
  const rruleProp = vevent.getFirstProperty('rrule');
  if (!rruleProp || vevent.hasProperty('rdate')) return;
  const recur = rruleProp.getFirstValue();
  if (!recur || recur.count) return;
  const startProp = vevent.getFirstProperty('dtstart');
  const start = startProp && startProp.getFirstValue();
  if (!start) return;
  const endProp = vevent.getFirstProperty('dtend');
  const end = endProp && endProp.getFirstValue();
  const length = end ? end.subtractDate(start) : null;
  const lengthDays = length ? Math.max(0, Math.ceil(length.toSeconds() / 86400)) : 1;
  const interval = recur.interval || 1;
  const gapDays = Math.floor((rangeStart - start.toUnixTime() * 1000) / DAY_MS) - lengthDays - 1;

  const newStart = start.clone();
  if (recur.freq === 'DAILY' || recur.freq === 'WEEKLY') {
    const periodDays = recur.freq === 'DAILY' ? interval : 7 * interval;
    const shiftDays = Math.floor((gapDays - 2 * periodDays) / periodDays) * periodDays;
    if (shiftDays <= 0) return;
    newStart.adjust(shiftDays, 0, 0, 0);
  } else if (recur.freq === 'MONTHLY') {
    const parts = recur.parts || {};
    const dayFromRule = parts.BYDAY || parts.BYMONTHDAY;
    if (!dayFromRule && start.day > 28) return; // "every month on the 31st" can't be shifted safely
    const shiftMonths = Math.floor((gapDays / 31 - 2 * interval) / interval) * interval;
    if (shiftMonths <= 0) return;
    const m = start.year * 12 + (start.month - 1) + shiftMonths;
    newStart.year = Math.floor(m / 12);
    newStart.month = (m % 12) + 1;
    if (dayFromRule) newStart.day = Math.min(start.day, 28);
  } else {
    return; // YEARLY and others are cheap enough to walk
  }

  startProp.setValue(newStart);
  if (end) {
    const newEnd = newStart.clone();
    newEnd.addDuration(length);
    endProp.setValue(newEnd);
  }
}

/**
 * Keep the calendar header, every VTIMEZONE, and only the VEVENTs that can reach [fromDay, toDay]
 * (YYYYMMDD strings, already padded by a couple of days for time zones).
 */
function prefilter(text, fromDay, toDay) {
  const first = text.indexOf('BEGIN:VEVENT');
  if (first === -1) return text;
  const parts = [text.slice(0, first)];

  let p = first;
  while ((p = text.indexOf('BEGIN:VTIMEZONE', p)) !== -1) {
    const q = text.indexOf('END:VTIMEZONE', p);
    if (q === -1) break;
    parts.push(text.slice(p, q + 13), '\r\n');
    p = q + 13;
  }

  let pos = first;
  for (;;) {
    const s = text.indexOf('BEGIN:VEVENT', pos);
    if (s === -1) break;
    const e = text.indexOf('END:VEVENT', s);
    if (e === -1) break;
    const block = text.slice(s, e + 10);
    if (mayReach(block, fromDay, toDay)) parts.push(block, '\r\n');
    pos = e + 10;
  }
  parts.push('END:VCALENDAR\r\n');
  return parts.join('');
}

function mayReach(block, fromDay, toDay) {
  const dt = /\nDTSTART[^:\r\n]*:(\d{8})/.exec(block);
  if (!dt) return true; // unusual: let ical.js decide
  const rrule = /\nRRULE:([^\r\n]*(?:\r?\n[ \t][^\r\n]*)*)/.exec(block);
  if (rrule) {
    const until = /UNTIL=(\d{8})/.exec(rrule[1].replace(/\r?\n[ \t]/g, ''));
    return !until || until[1] >= fromDay;
  }
  if (/\nRDATE/.test(block)) return true;
  const rid = /\nRECURRENCE-ID[^:\r\n]*:(\d{8})/.exec(block);
  if (rid && rid[1] >= fromDay && rid[1] <= toDay) return true; // moves/cancels an occurrence in the window
  if (dt[1] > toDay) return false;
  const dtend = /\nDTEND[^:\r\n]*:(\d{8})/.exec(block);
  if (dtend) return dtend[1] >= fromDay;
  if (/\nDURATION/.test(block)) return true;
  return dt[1] >= fromDay;
}

function compactDay(isoDay) {
  return isoDay.replace(/-/g, '');
}

function pushIfInRange(out, seen, cal, uid, item, startDate, endDate, tzHint, rangeStart, rangeEnd) {
  if (!startDate) return;
  const end = endDate || startDate;
  const startMs = toMs(startDate, tzHint);
  let endMs = toMs(end, tzHint);
  if (startDate.isDate && endMs <= startMs) endMs = startMs + 86400000;
  if (endMs <= rangeStart || startMs >= rangeEnd) return;

  const key = `${uid}|${startMs}`;
  if (seen.has(key)) return;
  seen.add(key);

  out.push({
    title: item.summary || '(No title)',
    location: item.location || '',
    calendar: cal.name,
    color: cal.color,
    allDay: !!startDate.isDate,
    // All-day events are calendar dates, not instants. `end` is exclusive, as in iCal.
    start: startDate.isDate ? dateString(startDate) : new Date(startMs).toISOString(),
    end: startDate.isDate ? allDayEnd(startDate, end) : new Date(endMs).toISOString(),
  });
}

function allDayEnd(startDate, end) {
  const start = dateString(startDate);
  const e = end && end.isDate ? dateString(end) : start;
  return e > start ? e : addDays(start, 1);
}

function isCancelled(component) {
  return String(component.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED';
}

function pickZone(tzid, calZone, homeZone) {
  if (tzid && isValidTimeZone(tzid)) return tzid;
  if (calZone && isValidTimeZone(calZone)) return calZone;
  return homeZone;
}

// UTC and VTIMEZONE-defined times convert exactly with ical.js. Floating times, and TZIDs the
// feed didn't define, are read as wall-clock time in the best zone we know.
function toMs(time, tzHint) {
  if (time.isDate) return zonedToUtc(dateString(time), '00:00', tzHint);
  const zone = time.zone;
  if (zone && zone !== ICAL.Timezone.localTimezone) return time.toUnixTime() * 1000;
  const hh = String(time.hour).padStart(2, '0');
  const mm = String(time.minute).padStart(2, '0');
  return zonedToUtc(dateString(time), `${hh}:${mm}`, tzHint) + time.second * 1000;
}

function dateString(t) {
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
}

function sortKey(ev, tz) {
  // All-day events sort to the top of their day.
  return ev.allDay ? zonedToUtc(ev.start, '00:00', tz) - 1 : Date.parse(ev.start);
}
