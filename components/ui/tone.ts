/**
 * Blue/coral, the app's one two-colour pair. Was hand-written as the same ternary in seven
 * places, which is seven chances for one to be edited and the rest not.
 *
 * Two names, one implementation: `sideTone` asks which way a trade points, `resultTone` whether
 * it is winning. Separate so one can change without dragging the other along.
 */

/** Blue when long, coral when short. */
export function sideTone(isBuy: boolean): string {
  return isBuy ? 'text-accent' : 'text-danger';
}

/** Blue at or above break-even, coral below. */
export function resultTone(isPositive: boolean): string {
  return isPositive ? 'text-accent' : 'text-danger';
}
