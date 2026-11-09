// Cloudflare Worker: serves the built dashboard (static assets) and one JSON endpoint.
// The frame never talks to third-party APIs directly. Old Android can't validate many modern
// certificates, and calendar URLs are secrets, so everything is fetched here.
import { getWeather } from './weather.js';
import { getEvents } from './calendar.js';
import { getYouTube, youtubeThumb } from './youtube.js';

const BUILD_ID = __BUILD_ID__;
const CACHE_MS = 5 * 60 * 1000;
let memo = { at: 0, body: null };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/dashboard') {
      const fresh = url.searchParams.has('fresh');
      if (!fresh && memo.body && Date.now() - memo.at < CACHE_MS) {
        return json(memo.body);
      }
      const body = await buildDashboard(env);
      memo = { at: Date.now(), body };
      return json(body);
    }

    if (url.pathname.startsWith('/api/yt-thumb/')) {
      return youtubeThumb(url.pathname.slice('/api/yt-thumb/'.length));
    }

    if (url.pathname === '/api/health') {
      return json({ ok: true, version: BUILD_ID, now: new Date().toISOString() });
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'not found' }, 404);
    }

    // Static files are served before the Worker runs, so anything reaching here doesn't exist.
    return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  },
};

async function buildDashboard(env) {
  const config = readConfig(env);
  // Each source fails on its own; the frame shows what it has.
  const [weather, calendar, youtube] = await Promise.allSettled([
    getWeather(config),
    getEvents(env.CALENDARS, config),
    getYouTube(env),
  ]);

  return {
    version: BUILD_ID,
    generatedAt: new Date().toISOString(),
    config: {
      city: config.city,
      timezone: config.timezone,
      locale: config.locale,
      tempUnit: config.tempUnit,
      nightStart: config.nightStart,
      nightEnd: config.nightEnd,
    },
    weather: settled(weather),
    calendar: settled(calendar),
    youtube: settled(youtube),
  };
}

function readConfig(env) {
  return {
    city: env.CITY_NAME || '',
    latitude: Number(env.LATITUDE || 43.6532),
    longitude: Number(env.LONGITUDE || -79.3832),
    timezone: env.TIMEZONE || 'UTC',
    locale: env.LOCALE || 'en-US',
    tempUnit: env.TEMP_UNIT === 'fahrenheit' ? 'fahrenheit' : 'celsius',
    nightStart: Number(env.NIGHT_START ?? 22),
    nightEnd: Number(env.NIGHT_END ?? 6),
    calendarDays: Math.min(Math.max(Number(env.CALENDAR_DAYS || 7), 1), 31),
  };
}

function settled(result) {
  if (result.status === 'fulfilled') return { ok: true, data: result.value };
  console.error(result.reason);
  return { ok: false, error: String(result.reason?.message || result.reason) };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
