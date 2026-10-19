export function hotRank(score, ageHours) {
  const safeScore = Number.isFinite(score) ? Math.max(score, 0) : 0;
  const safeAge = Number.isFinite(ageHours) ? Math.max(ageHours, 0) : 0;
  return safeScore / Math.pow(safeAge + 2, 1.5);
}

export function ageHoursFromNow(isoTime, nowMs = Date.now()) {
  const ts = Date.parse(isoTime);
  if (Number.isNaN(ts)) return 0;
  return Math.max(0, (nowMs - ts) / 3600000);
}
