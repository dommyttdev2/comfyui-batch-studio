const DAY = 86_400_000;
function leap(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
export function formatIsoUtc(ticks: number): string {
  if (!Number.isFinite(ticks)) throw new Error('Invalid timestamp.');
  let days = Math.floor(ticks / DAY),
    year = 1970;
  while (days < 0) {
    year--;
    days += leap(year) ? 366 : 365;
  }
  while (days >= (leap(year) ? 366 : 365)) {
    days -= leap(year) ? 366 : 365;
    year++;
  }
  if (year < 0 || year > 9999) throw new Error('Timestamp is outside supported calendar range.');
  const months = [31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let month = 0;
  while (days >= months[month]) days -= months[month++];
  const rest = ((Math.trunc(ticks) % DAY) + DAY) % DAY,
    pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(year, 4)}-${pad(month + 1)}-${pad(days + 1)}T${pad(Math.floor(rest / 3_600_000))}:${pad(Math.floor(rest / 60_000) % 60)}:${pad(Math.floor(rest / 1000) % 60)}.${pad(rest % 1000, 3)}Z`;
}
export function executionArchiveTimestampJst(value: string) {
  const iso = formatIsoUtc(Date.parse(value) + 9 * 3_600_000);
  return iso.slice(0, 10).replaceAll('-', '') + '_' + iso.slice(11, 19).replaceAll(':', '');
}
