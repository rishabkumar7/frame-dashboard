// Sample events shown until you set the CALENDARS secret.
import { zonedToUtc, addDays } from './time.js';

const FAMILY = { calendar: 'Family', color: '#e07a5f' };
const WORK = { calendar: 'Work', color: '#81b29a' };
const KIDS = { calendar: 'School', color: '#f2cc8f' };

export function demoEvents(config, today) {
  const tz = config.timezone;
  const at = (dayOffset, start, end, title, cal, location = '') => ({
    title,
    location,
    ...cal,
    allDay: false,
    start: new Date(zonedToUtc(addDays(today, dayOffset), start, tz)).toISOString(),
    end: new Date(zonedToUtc(addDays(today, dayOffset), end, tz)).toISOString(),
  });
  const allDay = (dayOffset, days, title, cal) => ({
    title,
    location: '',
    ...cal,
    allDay: true,
    start: addDays(today, dayOffset),
    end: addDays(today, dayOffset + days),
  });

  return [
    allDay(0, 1, 'Recycling day', FAMILY),
    at(0, '08:15', '08:45', 'School drop-off', KIDS),
    at(0, '10:00', '10:30', 'Team stand-up', WORK),
    at(0, '13:00', '14:00', 'Livestream: building a photo frame', WORK, 'Studio'),
    at(0, '18:30', '19:30', 'Family dinner', FAMILY),
    at(1, '07:00', '08:00', 'Gym', FAMILY),
    at(1, '16:00', '17:00', 'Swimming lessons', KIDS, 'Community pool'),
    allDay(2, 2, 'Grandparents visiting', FAMILY),
    at(2, '11:00', '12:00', 'Dentist', FAMILY, 'Main St Dental'),
    at(3, '09:30', '10:30', 'Conference talk rehearsal', WORK),
    at(4, '19:00', '21:00', 'Movie night', FAMILY),
    at(5, '10:00', '11:30', 'Farmers market', FAMILY),
  ];
}
