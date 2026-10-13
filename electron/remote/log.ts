export interface LoggedAction {
  seq: number;
  action: unknown;
}

/**
 * The renderer's recent actions, as it numbered them within one epoch. A device that resumes inside the log gets what it
 * missed; one from another epoch, from the future, or from before the oldest entry gets a snapshot instead.
 */
export class ActionLog {
  epoch = '';
  /** The seq just before the first entry. */
  private base = 0;
  private entries: LoggedAction[] = [];
  private readonly capacity: number;

  constructor(capacity = 2000) {
    this.capacity = capacity;
  }

  get seq() {
    return this.base + this.entries.length;
  }

  /** A new epoch starts an empty log at `seq`: the renderer reloaded or turned streaming back on, so older numbers mean nothing. */
  begin(epoch: string, seq: number) {
    this.epoch = epoch;
    this.base = seq;
    this.entries = [];
  }

  append(epoch: string, seq: number, action: unknown) {
    if (epoch !== this.epoch || seq !== this.seq + 1) this.begin(epoch, seq - 1);
    this.entries.push({ seq, action });
    if (this.entries.length <= this.capacity) return;
    // ponytail: shift is O(n) on a 2000-entry array a few times a second; a ring buffer if the stream gets busier.
    this.entries.shift();
    this.base++;
  }

  /** Actions after `seq`, or null when the gap can't be filled from the log. */
  since(epoch: string, seq: number): LoggedAction[] | null {
    if (epoch !== this.epoch || seq < this.base || seq > this.seq) return null;
    return this.entries.slice(seq - this.base);
  }
}
