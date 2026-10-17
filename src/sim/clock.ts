// TimeAndCalendar: one absolute game-minute counter is the only source of time.
export const MIN_PER_HOUR = 60;
export const MIN_PER_DAY = 1440;
export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const dayIndex = (minute: number) => Math.floor(minute / MIN_PER_DAY);
export const minuteOfDay = (minute: number) => ((minute % MIN_PER_DAY) + MIN_PER_DAY) % MIN_PER_DAY;
export const dayOfWeek = (minute: number) => dayIndex(minute) % 7;
export const hourOfDay = (minute: number) => minuteOfDay(minute) / 60;
export const at = (day: number, hour: number, min = 0) => day * MIN_PER_DAY + hour * 60 + min;

export function fmtClock(minute: number): string {
  const m = Math.floor(minuteOfDay(minute));
  const h = Math.floor(m / 60);
  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function fmtDate(minute: number): string {
  const d = dayIndex(minute);
  return `${DAY_NAMES[d % 7]}, Day ${d + 1}`;
}

export function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** daylight factor 0 (night) .. 1 (midday) used by the renderer */
export function daylight(minute: number): number {
  const h = hourOfDay(minute);
  if (h < 5 || h > 21) return 0;
  if (h < 7) return (h - 5) / 2;
  if (h > 19) return (21 - h) / 2;
  return 1;
}
