// Frame dashboard. Plain JS on purpose: it has to run for weeks on a slow, old Android WebView.
// Avoid JS newer than Chrome 106 (no toSorted, Object.groupBy, Promise.withResolvers, ...).
import '@fontsource-variable/inter';
import '@fontsource-variable/fraunces';
import './styles.css';
import { weatherIcon, weatherLabel } from './weather-icons.js';

const BUILD_ID = __BUILD_ID__;
const REFRESH_MS = 10 * 60 * 1000;
const PHOTO_MS = 45 * 1000;
const STALE_MS = 45 * 60 * 1000;
const CACHE_KEY = 'frame-dashboard:last';
const bootedAt = Date.now();

const $ = (name) => document.querySelector(`[data-el="${name}"]`);
const app = document.getElementById('app');

// Until the first response arrives, fall back to the device's own zone and locale.
let config = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  locale: navigator.language || 'en-US',
  nightStart: 22,
  nightEnd: 6,
  city: '',
};
let data = null;
let lastOk = 0;
let failing = false;
let nightSnoozeUntil = 0;

/* ---------------- formatting (formatters cached per locale + zone) ---------------- */

const fmtCache = new Map();
function fmt(kind, opts) {
  const key = `${kind}|${config.locale}|${config.timezone}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(config.locale, Object.assign({ timeZone: config.timezone }, opts));
    fmtCache.set(key, f);
  }
  return f;
}
const fmtClock = () => fmt('clock', { hour: 'numeric', minute: '2-digit' });
const fmtDate = () => fmt('date', { weekday: 'long', month: 'long', day: 'numeric' });
const SHORT_DATE = { month: 'short', day: 'numeric' };
const WEEKDAY = { weekday: 'long' };
const WEEKDAY_SHORT = { weekday: 'short' };
const fmtHour = () => fmt('hour', { hour: 'numeric' });

function parts(ms) {
  const out = {};
  fmt('parts', {
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
    .formatToParts(new Date(ms))
    .forEach((p) => {
      out[p.type] = p.value;
    });
  return out;
}

/** "YYYY-MM-DD" for an instant, in the home time zone. */
function dayKey(ms) {
  const p = parts(ms);
  return `${p.year}-${p.month}-${p.day}`;
}

function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Noon UTC on that date: safe to format as a calendar date in any zone. */
function keyToDate(key) {
  return new Date(`${key}T12:00:00Z`);
}

/** Format a calendar date ("2026-11-09") without the home zone shifting it. */
function fmtKeyDate(kind, opts, key) {
  const cacheKey = `${kind}|${config.locale}|UTC`;
  let f = fmtCache.get(cacheKey);
  if (!f) {
    f = new Intl.DateTimeFormat(config.locale, Object.assign({ timeZone: 'UTC' }, opts));
    fmtCache.set(cacheKey, f);
  }
  return f.format(keyToDate(key));
}

function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/* ---------------- clock + night mode (once a minute) ---------------- */

let clockTimer = 0;
let lastMinute = '';

function tick() {
  clearTimeout(clockTimer);
  const now = Date.now();
  const p = parts(now);
  const minute = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;

  if (minute !== lastMinute) {
    lastMinute = minute;
    renderClock(now, +p.hour);
    renderNight(now, +p.hour);
    if (data) {
      renderAgenda(now);
      renderStatus(now);
    }
    // Reload once a night to shed any memory the WebView has accumulated.
    if (p.hour === '03' && p.minute === '30' && now - bootedAt > 3600000) location.reload();
  }
  // Wake just after the next minute starts.
  clockTimer = setTimeout(tick, 60000 - (now % 60000) + 50);
}

function clockHtml(ms) {
  const segs = fmtClock().formatToParts(new Date(ms));
  let main = '';
  let period = '';
  segs.forEach((s) => {
    if (s.type === 'dayPeriod') period = s.value;
    else main += s.value;
  });
  main = main.trim();
  return { main, period, html: escapeHtml(main) + (period ? `<span class="ampm">${escapeHtml(period)}</span>` : '') };
}

function renderClock(now, hour) {
  const c = clockHtml(now);
  const timeEl = $('time');
  if (timeEl.dataset.v !== c.html) {
    timeEl.innerHTML = c.html;
    timeEl.dataset.v = c.html;
  }
  setText($('date'), fmtDate().format(new Date(now)));
  const greet = hour < 5 ? 'Good night' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  setText($('greeting'), config.city ? `${greet} · ${config.city}` : greet);
}

function isNight(hour) {
  const { nightStart: s, nightEnd: e } = config;
  if (s === e) return false;
  return s < e ? hour >= s && hour < e : hour >= s || hour < e;
}

function renderNight(now, hour) {
  const night = $('night');
  const on = isNight(hour) && now > nightSnoozeUntil;
  night.hidden = !on;
  if (on) {
    setText($('night-time'), clockHtml(now).main);
    setText($('night-date'), fmtDate().format(new Date(now)));
  }
}

/* ---------------- weather ---------------- */

function renderWeather() {
  const el = $('weather');
  const w = data && data.weather;
  if (!w || !w.ok) {
    el.innerHTML = `<p class="muted">${w ? 'Weather unavailable right now.' : 'Loading weather…'}</p>`;
    return;
  }
  const d = w.data;
  const cur = d.current;
  const today = d.daily[0];

  const hours = d.hourly
    .slice(0, 5)
    .map((h) => {
      const label = fmtHour().format(keyTimeToDate(h.time));
      return `<div class="wx-hour">${escapeHtml(label)}${weatherIcon(h.code, h.isDay)}<strong>${h.temp}°</strong></div>`;
    })
    .join('');

  const days = d.daily
    .slice(1, 6)
    .map((day) => {
      const precip = day.precip >= 30 ? `<span class="wx-day-precip">${day.precip}% rain</span>` : '';
      return `<div class="wx-day">
        <span class="wx-day-name">${escapeHtml(fmtKeyDate('wkshort', WEEKDAY_SHORT, day.date))}</span>
        ${weatherIcon(day.code, true)}
        <span>${precip}</span>
        <span class="wx-range">${day.max}°<span>${day.min}°</span></span>
      </div>`;
    })
    .join('');

  el.innerHTML = `
    <div class="wx-now">
      ${weatherIcon(cur.code, cur.isDay)}
      <div>
        <div class="wx-temp">${cur.temp}<sup>${escapeHtml(d.unit)}</sup></div>
      </div>
      <div>
        <p class="wx-desc">${escapeHtml(weatherLabel(cur.code))}</p>
        <p class="wx-meta">H ${today.max}° · L ${today.min}°<br>Feels like ${cur.feelsLike}°</p>
      </div>
    </div>
    <div class="wx-hours">${hours}</div>
    <div class="wx-days">${days}</div>`;
}

/** Open-Meteo local time string ("2026-11-09T14:00") → a Date that formats as that wall time. */
function keyTimeToDate(local) {
  // Find the instant whose home-zone wall time equals `local` (good to the hour, which is all we show).
  const guess = Date.parse(`${local}:00Z`);
  const p = parts(guess);
  const shown = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
  return new Date(guess - (shown - guess));
}

/* ---------------- YouTube ---------------- */

const YT_LOGO =
  '<svg class="yt-logo" viewBox="0 0 28 20" aria-hidden="true"><rect width="28" height="20" rx="5.5" fill="#ff3d3d"/><path d="M11.2 5.8v8.4l7.2-4.2z" fill="#ffffff"/></svg>';

let ytSig = '';

function compact(n) {
  try {
    return new Intl.NumberFormat(config.locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  } catch (e) {
    return String(n);
  }
}

function timeAgo(iso) {
  const secs = (Date.parse(iso) - Date.now()) / 1000;
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  const rtf = new Intl.RelativeTimeFormat(config.locale, { numeric: 'auto' });
  for (let i = 0; i < units.length; i++) {
    if (Math.abs(secs) >= units[i][1] || units[i][0] === 'minute') {
      return rtf.format(Math.round(secs / units[i][1]), units[i][0]);
    }
  }
  return '';
}

function renderYouTube() {
  const el = $('youtube');
  const r = data && data.youtube;
  let html = '';

  if (r && r.ok && r.data.configured) {
    const y = r.data;
    const subs = y.subscribers == null ? 'Hidden' : compact(y.subscribers);
    let latest = '';
    if (y.latest) {
      latest = `<div class="yt-latest">
        <img class="yt-thumb" src="${escapeHtml(y.latest.thumbnail)}" alt="">
        <div class="yt-latest-text">
          <p class="yt-latest-label">Latest video</p>
          <p class="yt-latest-title">${escapeHtml(y.latest.title)}</p>
          <p class="yt-latest-meta">${escapeHtml(compact(y.latest.views))} views · ${escapeHtml(timeAgo(y.latest.publishedAt))}</p>
        </div>
      </div>`;
    }
    html = `<div class="yt-head">${YT_LOGO}<span class="yt-name">${escapeHtml(y.title)}</span></div>
      <div class="yt-stats">
        <div class="yt-subs"><span class="yt-big">${escapeHtml(subs)}</span><span class="yt-label">subscribers</span></div>
        <div class="yt-minor"><strong>${escapeHtml(compact(y.views))}</strong> views<br><strong>${escapeHtml(compact(y.videos))}</strong> videos</div>
      </div>${latest}`;
  } else if (r && r.ok && r.data.handle) {
    html = `<div class="yt-head">${YT_LOGO}<span class="yt-name">${escapeHtml(r.data.handle)}</span></div>
      <p class="muted yt-hint">Add <code>YOUTUBE_API_KEY</code> to show channel stats.</p>`;
  } else if (r && !r.ok) {
    html = `<div class="yt-head">${YT_LOGO}<span class="yt-name">YouTube</span></div>
      <p class="muted yt-hint">Stats unavailable right now.</p>`;
  }

  el.hidden = !html;
  if (html !== ytSig) {
    el.innerHTML = html;
    ytSig = html;
  }
}

/* ---------------- agenda ---------------- */

let agendaSig = '';

function renderAgenda(now) {
  const cal = data.calendar;
  const el = $('agenda');
  $('demo-pill').hidden = !(cal && cal.ok && cal.data.demo);

  if (!cal || !cal.ok) {
    const html = `<p class="agenda-empty">Calendar unavailable right now.</p>`;
    if (agendaSig !== html) el.innerHTML = agendaSig = html;
    return;
  }

  const today = dayKey(now);
  const byDay = new Map();
  const put = (key, item) => {
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(item);
  };

  cal.data.events.forEach((ev) => {
    if (ev.allDay) {
      // Show multi-day all-day events on every day they cover (end is exclusive).
      for (let k = ev.start < today ? today : ev.start; k < ev.end; k = addDays(k, 1)) put(k, { ev });
      return;
    }
    const start = Date.parse(ev.start);
    const end = Date.parse(ev.end);
    if (end <= now - 2 * 3600000) return; // ended over 2h ago
    const key = start < now && dayKey(start) < today ? today : dayKey(start);
    put(key, { ev, start, end });
  });

  let html = '';
  let shown = 0;
  for (let i = 0; i < 8 && shown < 14; i++) {
    const key = addDays(today, i);
    const items = byDay.get(key) || [];
    if (!items.length && i > 0) continue;

    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : fmtKeyDate('weekday', WEEKDAY, key);
    html += `<div class="agenda-day"><p class="agenda-day-label">${escapeHtml(label)}<span>${escapeHtml(fmtKeyDate('short', SHORT_DATE, key))}</span></p>`;
    if (!items.length) html += `<p class="agenda-empty">Nothing scheduled. Enjoy the day.</p>`;

    items.forEach(({ ev, start, end }) => {
      shown++;
      let cls = 'event';
      let time;
      if (ev.allDay) {
        time = 'All day';
      } else {
        if (end <= now) cls += ' is-past';
        else if (start <= now) cls += ' is-now';
        const startsEarlier = dayKey(start) < key;
        time = startsEarlier
          ? `Until<small>${escapeHtml(fmtClock().format(new Date(end)))}</small>`
          : `${escapeHtml(fmtClock().format(new Date(start)))}<small>${escapeHtml(durationLabel(end - start))}</small>`;
      }
      const nowTag = cls.indexOf('is-now') >= 0 ? '<span class="now-tag">Now</span>' : '';
      const sub = [ev.location, ev.calendar].filter(Boolean).map(escapeHtml).join(' · ');
      html += `<div class="${cls}">
        <span class="event-bar" style="background:${safeColor(ev.color)}"></span>
        <span class="event-time">${time}</span>
        <div><p class="event-title">${nowTag}${escapeHtml(ev.title)}</p><p class="event-sub">${sub}</p></div>
      </div>`;
    });
    html += '</div>';
  }

  // Only touch the DOM when something visible changed.
  if (html !== agendaSig) {
    el.innerHTML = html;
    agendaSig = html;
  }
}

function durationLabel(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function safeColor(c) {
  return /^#[0-9a-f]{6}$/i.test(c || '') ? c : '#81b29a';
}

/* ---------------- status line ---------------- */

function renderStatus(now) {
  const age = lastOk ? now - lastOk : Infinity;
  let left = lastOk ? `Updated ${fmtClock().format(new Date(lastOk))}` : 'Connecting…';
  if (failing) left += ' · offline, retrying';
  const stale = age > STALE_MS;
  const html = `<span class="${stale ? 'is-stale' : ''}">${escapeHtml(left)}</span><span>Weather data by Open-Meteo.com</span>`;
  const el = $('status');
  if (el.dataset.v !== html) {
    el.innerHTML = html;
    el.dataset.v = html;
  }
}

/* ---------------- data loading with backoff ---------------- */

let refreshTimer = 0;
let backoff = 0;

async function refresh() {
  clearTimeout(refreshTimer);
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch('/api/dashboard', { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();

    // A new deploy is live: load it. At most once per 10 minutes, so a mismatch can never loop.
    if (body.version && body.version !== BUILD_ID && canReload()) {
      location.reload();
      return;
    }

    apply(body);
    lastOk = Date.now();
    failing = false;
    backoff = 0;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: lastOk, body }));
    } catch (e) {
      /* storage full or unavailable: fine */
    }
    refreshTimer = setTimeout(refresh, REFRESH_MS);
  } catch (err) {
    // Wi-Fi often comes up after the page at boot. Retry quickly, then back off to 5 minutes.
    failing = true;
    backoff = Math.min(backoff ? backoff * 2 : 5000, 5 * 60 * 1000);
    refreshTimer = setTimeout(refresh, backoff);
  } finally {
    clearTimeout(timeout);
    renderStatus(Date.now());
  }
}

function canReload() {
  try {
    const last = Number(sessionStorage.getItem('frame-dashboard:reloaded') || 0);
    if (Date.now() - last < 10 * 60 * 1000) return false;
    sessionStorage.setItem('frame-dashboard:reloaded', String(Date.now()));
    return true;
  } catch (e) {
    return false;
  }
}

function apply(body) {
  data = body;
  if (body.config) {
    const changed = body.config.timezone !== config.timezone || body.config.locale !== config.locale;
    config = Object.assign({}, config, body.config);
    if (changed) {
      fmtCache.clear();
      lastMinute = '';
    }
  }
  renderWeather();
  renderYouTube();
  agendaSig = '';
  lastMinute = '';
  tick();
}

function restoreCached() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (cached && cached.body) {
      lastOk = cached.at;
      apply(cached.body);
    }
  } catch (e) {
    /* ignore */
  }
}

/* ---------------- photos ---------------- */

// Every image in src/photos is bundled at build time. Resize them first (npm run photos).
const photoModules = import.meta.glob('../photos/*.{jpg,jpeg,png,webp,JPG,JPEG,PNG,WEBP}', {
  eager: true,
  query: '?url',
  import: 'default',
});
const photos = shuffle(Object.keys(photoModules).map((k) => photoModules[k]));
let photoIndex = -1;
let photoTimer = 0;
let frontLayer = null;

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

function nextPhoto() {
  clearTimeout(photoTimer);
  if (!photos.length) {
    $('photo-empty').hidden = false;
    return;
  }
  photoIndex = (photoIndex + 1) % photos.length;
  const a = $('photo-a');
  const b = $('photo-b');
  const back = frontLayer === a ? b : a;
  const img = new Image();
  img.onload = img.onerror = () => {
    back.src = photos[photoIndex];
    back.classList.add('is-shown');
    if (frontLayer) frontLayer.classList.remove('is-shown');
    frontLayer = back;
    if (photos.length > 1) photoTimer = setTimeout(nextPhoto, PHOTO_MS);
  };
  img.src = photos[photoIndex];
}

/* ---------------- touch ---------------- */

$('photo').addEventListener('click', () => {
  app.classList.toggle('photo-full');
});

$('night').addEventListener('click', () => {
  // Tap the night clock to see the dashboard for two minutes.
  nightSnoozeUntil = Date.now() + 2 * 60 * 1000;
  $('night').hidden = true;
  setTimeout(() => {
    lastMinute = '';
    tick();
  }, 2 * 60 * 1000 + 100);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  lastMinute = '';
  tick();
  if (Date.now() - lastOk > REFRESH_MS) refresh();
});

/* ---------------- boot ---------------- */

window.__frameBooted = true;
restoreCached();
tick();
renderStatus(Date.now());
nextPhoto();
refresh();
