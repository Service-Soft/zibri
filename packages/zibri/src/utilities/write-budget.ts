import { Ms } from './ms';

/**
 * How many kinds of entries a minute keeps apart once its budget is spent.
 */
export const MAX_COLLAPSED_KINDS: number = 100;

/**
 * Entries past the budget, while they are still being counted.
 */
type CollapsedEntries<T> = {
    /**
     * The first of them.
     */
    first: T,
    /**
     * How many there were so far.
     */
    count: number,
    /**
     * When the last of them happened.
     */
    lastAt: Date
};

/**
 * Bounds how many entries are written in a minute.
 *
 * Within the budget every entry is written on its own. Past it, entries of one kind are counted into
 * one entry per kind, written when the minute ends or when flushed. At most a hundred kinds are kept
 * apart; the rest are counted in one entry per overflow kind.
 */
export abstract class WriteBudget<T> {

    /**
     * When the current minute ends.
     */
    private windowEndsAt: number = 0;

    /**
     * How many entries were written on their own this minute.
     */
    private written: number = 0;

    /**
     * The kinds counted this minute, by what makes them one kind.
     */
    private readonly collapsed: Map<string, CollapsedEntries<T>> = new Map();

    /**
     * What is past the kinds kept apart, by overflow kind.
     */
    private readonly overflow: Map<string, CollapsedEntries<T>> = new Map();

    /**
     * The timer writing the counted entries when the minute ends, if anything was counted.
     */
    private windowEnd: NodeJS.Timeout | undefined;

    /**
     * Creates a budget.
     * @param maxEntriesPerMinute - How many entries a minute are written on their own.
     * @param writeEntries - Writes entries.
     */
    constructor(
        private readonly maxEntriesPerMinute: number,
        private readonly writeEntries: (entries: T[]) => Promise<void>
    ) {}

    /**
     * Writes what the budget admits, and counts the rest.
     * @param entries - The entries, oldest first.
     */
    async write(entries: T[]): Promise<void> {
        const now: number = Date.now();
        const written: T[] = [];
        if (now >= this.windowEndsAt) {
            // the previous minute's counts, should this arrive before its timer wrote them
            written.push(...this.takeCollapsed());
            this.windowEndsAt = now + Ms.MINUTE;
            this.written = 0;
        }

        const admitted: Set<T> = this.resolveAdmitted(entries);
        for (const entry of entries) {
            if (admitted.has(entry)) {
                written.push(entry);
                continue;
            }
            this.collapse(entry);
        }
        this.written += admitted.size;
        this.scheduleWindowEnd(now);

        if (written.length) {
            await this.writeEntries(written);
        }
    }

    /**
     * Writes what was counted so far, without waiting for the minute to end.
     */
    async flush(): Promise<void> {
        clearTimeout(this.windowEnd);
        this.windowEnd = undefined;
        const entries: T[] = this.takeCollapsed();
        if (entries.length) {
            await this.writeEntries(entries);
        }
    }

    /**
     * Resolves what makes entries one kind: everything they say, apart from when.
     * @param entry - The entry.
     * @returns The same string for every entry of its kind.
     */
    protected abstract resolveKind(entry: T): string;

    /**
     * Resolves what an entry is counted under once the kinds kept apart are used up, from a closed set.
     * @param entry - The entry.
     * @returns The same string for every entry counted together.
     */
    protected abstract resolveOverflowKind(entry: T): string;

    /**
     * Resolves how important an entry is. The more important ones of a batch keep what is left of the budget.
     * @param entry - The entry.
     * @returns The higher, the more important.
     */
    protected abstract resolveImportance(entry: T): number;

    /**
     * Gets when an entry happened.
     * @param entry - The entry.
     * @returns The time.
     */
    protected abstract getOccurredAt(entry: T): Date;

    /**
     * Builds the entry standing for the entries of one kind.
     * @param first - The first of them.
     * @param count - How many there were.
     * @param lastAt - When the last of them happened.
     * @returns The entry to write.
     */
    protected abstract toCollapsed(first: T, count: number, lastAt: Date): T;

    /**
     * Builds the entry standing for the entries of one overflow kind.
     * @param first - The first of them.
     * @param count - How many there were.
     * @param lastAt - When the last of them happened.
     * @returns The entry to write.
     */
    protected abstract toOverflow(first: T, count: number, lastAt: Date): T;

    /**
     * Resolves which entries of a batch are written on their own.
     * @param entries - The batch.
     * @returns The entries that fit in what is left of the budget.
     */
    private resolveAdmitted(entries: T[]): Set<T> {
        const left: number = Math.max(this.maxEntriesPerMinute - this.written, 0);
        return entries.length <= left
            ? new Set(entries)
            // most important first, so an error in a batch of info lines keeps its row. The sort is
            // stable, so among equals the earlier entry does
            : new Set([...entries].sort((a, b) => this.resolveImportance(b) - this.resolveImportance(a)).slice(0, left));
    }

    /**
     * Counts an entry into the entry of its kind.
     * @param entry - The entry past the budget.
     */
    private collapse(entry: T): void {
        const occurredAt: Date = this.getOccurredAt(entry);
        const kind: string = this.resolveKind(entry);
        const known: CollapsedEntries<T> | undefined = this.collapsed.get(kind);
        if (known) {
            known.count++;
            known.lastAt = occurredAt;
            return;
        }
        // bounded, because a message echoing input makes every entry a kind of its own
        if (this.collapsed.size < MAX_COLLAPSED_KINDS) {
            this.collapsed.set(kind, { first: entry, count: 1, lastAt: occurredAt });
            return;
        }
        const overflowKind: string = this.resolveOverflowKind(entry);
        const overflow: CollapsedEntries<T> | undefined = this.overflow.get(overflowKind);
        if (overflow) {
            overflow.count++;
            overflow.lastAt = occurredAt;
            return;
        }
        this.overflow.set(overflowKind, { first: entry, count: 1, lastAt: occurredAt });
    }

    /**
     * Removes and returns the entries counted so far.
     * @returns One entry per kind, then one per overflow kind.
     */
    private takeCollapsed(): T[] {
        const res: T[] = [
            ...[...this.collapsed.values()].map(c => this.toCollapsed(c.first, c.count, c.lastAt)),
            ...[...this.overflow.values()].map(c => this.toOverflow(c.first, c.count, c.lastAt))
        ];
        this.collapsed.clear();
        this.overflow.clear();
        return res;
    }

    /**
     * Arranges for the counted entries to be written when the minute ends, unless that is arranged.
     *
     * Unref'd, so it never holds the process open. Whoever owns the budget flushes it at shutdown.
     * @param now - The time the entries arrived.
     */
    private scheduleWindowEnd(now: number): void {
        if (this.windowEnd || (!this.collapsed.size && !this.overflow.size)) {
            return;
        }
        this.windowEnd = setTimeout(() => void this.flushAtWindowEnd(), this.windowEndsAt - now);
        this.windowEnd.unref();
    }

    /**
     * Writes the counted entries once the minute has ended, never rejecting.
     */
    private async flushAtWindowEnd(): Promise<void> {
        this.windowEnd = undefined;
        try {
            await this.flush();
        }
        catch (error) {
            // console for the reason the logger reports a failing transport there: logging a
            // failure to log would loop
            // eslint-disable-next-line no-console
            console.error('There was an error when writing the entries counted past the budget', error);
        }
    }
}