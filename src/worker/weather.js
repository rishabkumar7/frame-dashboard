// Weather from Open-Meteo (free, no API key).
// https://open-meteo.com/en/docs

export async function getWeather(config) {
  const params = new URLSearchParams({
    latitude: String(config.latitude),
    longitude: String(config.longitude),
    timezone: config.timezone,
    temperature_unit: config.tempUnit,
    wind_speed_unit: 'kmh',
    forecast_days: '6',
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m',
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset',
  });

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    cf: { cacheTtl: 600, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const w = await res.json();

  // Times from Open-Meteo are local wall-clock strings ("2026-11-09T14:00") in config.timezone.
  const nowLocal = w.current.time;
  const firstHour = w.hourly.time.findIndex((t) => t >= nowLocal.slice(0, 13));
  const hourly = [];
  for (let i = Math.max(firstHour, 0) + 1; i < w.hourly.time.length && hourly.length < 6; i += 2) {
    hourly.push({
      time: w.hourly.time[i],
      temp: Math.round(w.hourly.temperature_2m[i]),
      code: w.hourly.weather_code[i],
      isDay: w.hourly.is_day[i] === 1,
      precip: w.hourly.precipitation_probability[i],
    });
  }

  const daily = w.daily.time.map((date, i) => ({
    date,
    code: w.daily.weather_code[i],
    max: Math.round(w.daily.temperature_2m_max[i]),
    min: Math.round(w.daily.temperature_2m_min[i]),
    precip: w.daily.precipitation_probability_max[i],
    sunrise: w.daily.sunrise[i],
    sunset: w.daily.sunset[i],
  }));

  return {
    unit: config.tempUnit === 'fahrenheit' ? '°F' : '°C',
    current: {
      temp: Math.round(w.current.temperature_2m),
      feelsLike: Math.round(w.current.apparent_temperature),
      humidity: w.current.relative_humidity_2m,
      wind: Math.round(w.current.wind_speed_10m),
      code: w.current.weather_code,
      isDay: w.current.is_day === 1,
    },
    hourly,
    daily,
  };
}
