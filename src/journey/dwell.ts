/** Arrival-relative hold, using one caller clock; late loading never consumes the promised hold. */
export class ArrivalDwell {
 private arrival: number | null = null
 private startReported = false
 constructor(private readonly holdMs: number) {}
 step(now: number, arrived: boolean): boolean {
  if (!arrived) { this.arrival = null; this.startReported = false; return false }
  this.arrival ??= now
  return now - this.arrival >= this.holdMs
 }
 /** True exactly once per arrival: the moment the hold begins (the progress fill starts here, never at selection). */
 consumeStart(): boolean {
  if (this.arrival === null || this.startReported) return false
  this.startReported = true
  return true
 }
}
