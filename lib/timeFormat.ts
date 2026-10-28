/* ------------------------------------------------------------------ */
/*  Session time, in words                                             */
/* ------------------------------------------------------------------ */
/**
 * The two ways playback time is written down, shared by everything that writes it.
 *
 * They were private to the playback panel until the seeker on the chart started saying the same
 * two things. Two copies of "6h 12m" that round differently, or a stamp that is UTC in one place
 * and local in the other, would be read side by side on the same screen — the panel's readout
 * sits a few centimetres from the seeker's.
 */

const MINUTE = 60_000;

/**
 * `2026.08.14 13:00` — MT5's own stamp, and the app's everywhere else.
 *
 * UTC, deliberately. `toISOString` would do this in one line but drags the browser's timezone
 * into a value the user is about to compare against a candle: 05:00 typed in Kampala must mean
 * 05:00 on the chart, not 02:00.
 */
export function stampMinute(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}

/** How much tape sits in a span, in plain words: `45m`, `6h 12m`, `2d 3h`. */
export function spanLabel(ms: number): string {
  if (ms < MINUTE) return '0m';

  const minutes = Math.round(ms / MINUTE);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;

  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * `2026.08.19 10:24:03` — the same stamp as `stampMinute`, carried out to the second.
 *
 * MT5 writes a position and a deal to the second, and this was copied privately into the trade
 * list and the history list, character for character, twice. The two lists sit one tab apart and
 * describe the same trades, so the copies could never be allowed to drift — which is the whole
 * argument for there being one of them.
 *
 * UTC for the same reason `stampMinute` is: a fill time is compared against a candle, and a
 * browser timezone silently shifting one and not the other is the bug this avoids.
 */
export function stampSecond(ms: number): string {
  if (!ms) return '—';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}
