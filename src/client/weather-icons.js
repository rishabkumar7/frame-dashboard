// Static SVG weather icons (no animation: looping animations cost a lot of CPU on these frames).

const SUN = '#f2cc8f';
const CLOUD = '#d9d2c8';
const RAIN = '#8ab4d8';

const sun = (cx = 24, cy = 24, r = 8) => {
  let rays = '';
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const x1 = cx + Math.cos(a) * (r + 4);
    const y1 = cy + Math.sin(a) * (r + 4);
    const x2 = cx + Math.cos(a) * (r + 8);
    const y2 = cy + Math.sin(a) * (r + 8);
    rays += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
  }
  return `<g stroke="${SUN}" stroke-width="3" stroke-linecap="round" fill="${SUN}"><circle cx="${cx}" cy="${cy}" r="${r}"/>${rays}</g>`;
};

const moon = (cx = 24, cy = 24) =>
  `<path d="M${cx + 7} ${cy + 6}a12 12 0 1 1 -9 -17a9.5 9.5 0 0 0 9 17z" fill="${SUN}" transform="translate(-2 1)"/>`;

const cloud = (dx = 0, dy = 0, color = CLOUD) =>
  `<path transform="translate(${dx} ${dy})" fill="${color}" d="M14 38h22a8 8 0 0 0 0-16a11 11 0 0 0-21-3a9.5 9.5 0 0 0-1 19z"/>`;

const drops = (color = RAIN) =>
  `<g stroke="${color}" stroke-width="3" stroke-linecap="round"><line x1="17" y1="41" x2="15" y2="46"/><line x1="25" y1="41" x2="23" y2="46"/><line x1="33" y1="41" x2="31" y2="46"/></g>`;

const flakes = () =>
  `<g fill="#ffffff"><circle cx="16" cy="43" r="2.2"/><circle cx="24" cy="45" r="2.2"/><circle cx="32" cy="43" r="2.2"/></g>`;

const bolt = () => `<path d="M26 36l-6 8h5l-3 7l8-10h-5l3-5z" fill="${SUN}"/>`;

const fog = () =>
  `<g stroke="${CLOUD}" stroke-width="3" stroke-linecap="round"><line x1="9" y1="20" x2="39" y2="20"/><line x1="6" y1="27" x2="36" y2="27"/><line x1="12" y1="34" x2="42" y2="34"/></g>`;

function kind(code) {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain';
  if (code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'thunder';
  return 'cloudy';
}

const LABELS = {
  0: 'Clear',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Showers',
  81: 'Showers',
  82: 'Heavy showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm, hail',
  99: 'Thunderstorm, hail',
};

export function weatherLabel(code) {
  return LABELS[code] || 'Cloudy';
}

export function weatherIcon(code, isDay = true) {
  const body = {
    clear: isDay ? sun() : moon(),
    partly: (isDay ? sun(18, 18, 7) : `<g transform="translate(-6 -6) scale(0.8)">${moon()}</g>`) + cloud(4, 4),
    cloudy: cloud(-6, -6, '#8f877e') + cloud(2, 2),
    fog: fog(),
    rain: cloud(0, -6) + drops(),
    snow: cloud(0, -6) + flakes(),
    thunder: cloud(0, -8, '#a59d93') + bolt(),
  }[kind(code)];
  return `<svg class="wx-icon" viewBox="0 0 48 48" aria-hidden="true">${body}</svg>`;
}
