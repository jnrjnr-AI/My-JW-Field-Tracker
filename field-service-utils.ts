export function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function formatMinutes(seconds: number) {
  if (seconds < 60) return "0 min";
  return `${Math.floor(seconds / 60)} min`;
}

export function isWithinDays(dateString: string, days: number, now = Date.now()) {
  const date = new Date(dateString).getTime();
  return Number.isFinite(date) && now - date < days * 24 * 60 * 60 * 1000 && now >= date;
}

export function filterByQuery<T extends object>(items: T[], query: string, fields: Array<keyof T>) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return items;
  return items.filter((item) => fields.some((field) => String(item[field]).toLowerCase().includes(normalized)));
}
