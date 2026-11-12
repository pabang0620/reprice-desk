// Run log times as HH:MM:SS (UTC), without the date and milliseconds.
export function clockTime(value) {
  const t = new Date(value)
  return Number.isNaN(t.getTime()) ? String(value ?? '') : t.toISOString().slice(11, 19)
}
