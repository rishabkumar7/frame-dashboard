// Small time-zone helpers built on Intl, so the worker doesn't depend on its own (UTC) clock zone.

const formatters = new Map();
function partsFormatter(timeZone) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function zoneParts(ms, timeZone) {
  const p = {};
  for (const { type, value } of partsFormatter(timeZone).formatToParts(new Date(ms))) p[type] = value;
  return p;
}

/** Offset of `timeZone` from UTC at instant `ms`, in ms. */
function offsetAt(ms, timeZone) {
  const p = zoneParts(ms, timeZone);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** "2026-11-09" + "14:30" in "America/Toronto" → epoch ms. */
export function zonedToUtc(date, time, timeZone) {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let ms = guess - offsetAt(guess, timeZone);
  // Second pass fixes the guess when it landed across a DST change.
  ms = guess - offsetAt(ms, timeZone);
  return ms;
}

/** Epoch ms → "YYYY-MM-DD" in `timeZone`. */
export function zonedDateString(ms, timeZone) {
  const p = zoneParts(ms, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

export function isValidTimeZone(tz) {
  try {
    partsFormatter(tz);
    return true;
  } catch {
    return false;
  }
}
