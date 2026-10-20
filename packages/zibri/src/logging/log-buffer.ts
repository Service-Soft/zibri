import { LogLevel } from './log-level.enum.ts';
import { Log } from './log.model.ts';

/**
 * A bounded queue of log entries waiting to be written.
 *
 * It exists so that logging can stop blocking its caller. Awaiting every write is what currently
 * throttles whatever is producing logs, and once that goes away nothing does - so the queue has to
 * refuse work rather than grow. Unbounded is how a slow log transport turns into an out of memory
 * kill, and it happens at the worst moment: a burst of errors is exactly when the database those
 * errors are about is already struggling.
 *
 * Something is therefore always dropped when it is full. The policy decides *what*, and the entries
 * that survive are the ones worth having:
 *
 * 1. The least important entry in play loses, comparing the incoming entry against everything held.
 * 2. Among equals the oldest loses, because during an incident the newest occurrences describe what
 * is happening now and the buffer already holds plenty of the older ones.
 *
 * That means a buffer full of errors will not evict one to make room for a debug line, and a buffer
 * full of debug lines gives way to a single error immediately.
 *
 * Nothing is dropped quietly. `takeDropped` reports how many went missing since it was last asked,
 * so the gap can be recorded rather than inferred from a hole in the timestamps.
 */
export class LogBuffer {

    private readonly entries: Log[] = [];

    private dropped: number = 0;

    /**
     * Creates a buffer that holds at most the given number of entries.
     * @param capacity - The most entries to hold before dropping starts.
     */
    constructor(readonly capacity: number) {}

    /**
     * How many entries are currently waiting.
     * @returns The number of queued entries.
     */
    get size(): number {
        return this.entries.length;
    }

    /**
     * Queues an entry, dropping something when there is no room.
     * @param log - The entry to queue.
     */
    add(log: Log): void {
        if (this.entries.length < this.capacity) {
            this.entries.push(log);
            return;
        }

        const toDrop: number = this.indexOfEntryToDrop(log.level);
        if (toDrop === -1) {
            // everything held is more important than this one, so this one is what goes
            this.dropped++;
            return;
        }

        this.entries.splice(toDrop, 1);
        this.dropped++;
        this.entries.push(log);
    }

    /**
     * Removes and returns everything currently queued, oldest first.
     * @returns The queued entries.
     */
    takeAll(): Log[] {
        return this.entries.splice(0, this.entries.length);
    }

    /**
     * Removes and returns the number of entries dropped since this was last called.
     * @returns The number dropped.
     */
    takeDropped(): number {
        const res: number = this.dropped;
        this.dropped = 0;
        return res;
    }

    /**
     * Finds the entry that should give way to one arriving at the given level.
     * @param incoming - The level of the entry trying to get in.
     * @returns The index of the entry to evict, or -1 when the incoming entry is the one to drop.
     */
    private indexOfEntryToDrop(incoming: LogLevel): number {
        let index: number = -1;
        let lowest: LogLevel = incoming;

        for (const [i, entry] of this.entries.entries()) {
            const level: LogLevel = entry.level;
            // strictly lower, so the first entry found at a level stays the one picked - and since
            // entries are held oldest first, that is the oldest of the least important level
            if (level < lowest) {
                lowest = level;
                index = i;
            }
        }

        if (index !== -1) {
            return index;
        }

        // nothing held is less important than the incoming entry. It still gets in if something
        // matches its level, in which case the oldest of those makes way
        return this.entries.findIndex(e => e.level === incoming);
    }
}