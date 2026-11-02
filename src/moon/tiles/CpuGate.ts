/** Spread arrived tile work over frames. One shared fallback timer prevents a
 * stopped render loop from deadlocking without releasing an entire burst at once. */
export class CpuGate {
  private queue: Array<() => void> = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  constructor(private readonly wake: () => void, private readonly timeoutMs = 80) {}
  get pending(): boolean { return this.queue.length > 0 }
  wait(signal: AbortSignal): Promise<void> {
    if (this.disposed || signal.aborted) return Promise.resolve()
    return new Promise((resolve) => {
      const finish = (): void => {
        const i = this.queue.indexOf(finish)
        if (i >= 0) this.queue.splice(i, 1)
        signal.removeEventListener('abort', finish)
        if (!this.pending && this.timer !== null) { clearTimeout(this.timer); this.timer = null }
        resolve()
      }
      this.queue.push(finish)
      signal.addEventListener('abort', finish, { once: true })
      this.arm()
      this.wake()
    })
  }
  tick(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null }
    this.queue[0]?.()
    this.arm()
  }
  dispose(): void {
    this.disposed = true
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null }
    while (this.pending) this.queue[0]()
  }
  private arm(): void {
    if (this.pending && this.timer === null && !this.disposed) {
      this.timer = setTimeout(() => { this.timer = null; this.tick() }, this.timeoutMs)
    }
  }
}
