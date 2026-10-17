/** Short dates for Simkl rows (pure, no native code). */

/** "15 Oct 2026", or "Today" / "Yesterday" / "Tomorrow". */
export function fmtDay(iso: string, now = Date.now()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = (t: number) => new Date(t).toDateString();
  if (day(d.getTime()) === day(now)) return 'today';
  if (day(d.getTime()) === day(now - 86_400_000)) return 'yesterday';
  if (day(d.getTime()) === day(now + 86_400_000)) return 'tomorrow';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "3 d ago", "2 mo ago", "today". */
export function fmtAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const days = Math.floor((now - t) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} d ago`;
  if (days < 365) return `${Math.floor(days / 30)} mo ago`;
  return `${Math.floor(days / 365)} y ago`;
}
