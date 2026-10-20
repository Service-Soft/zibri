import { JsonUtilities } from '../../utilities/json.utilities.ts';
import { Ms } from '../../utilities/ms.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { LogLevel } from '../log-level.enum.ts';
import { Log } from '../log.model.ts';

/**
 * How many kinds of entries a minute keeps apart once its budget is spent.
 */
const maxCollapsedKinds: number = 100;

/**
 * The message of the row counting what is past the kinds kept apart.
 */
const overflowMessage: string = `entries past the log budget, beyond the first ${maxCollapsedKinds} kinds`;

/**
 * A row standing for entries past the budget, while they are still being counted.
 */
type CollapsedLog = {
    /**
     * The first of them, whose message and context the row carries.
     */
    log: Log,
    /**
     * How many there were so far.
     */
    count: number,
    /**
     * When the last of them was logged.
     */
    lastAt: Date
};

/**
 * Bounds how many rows a transport writes in a minute.
 *
 * Within the budget every entry is a row of its own. Past it, entries of the same tenant, level,
 * message and metadata are counted into one row per kind, written when the minute ends or when the
 * logger is flushed. At most a hundred kinds are kept apart; the rest are counted in one row per level.
 */
export class LogBudget {

    /**
     * When the current minute ends.
     */
    private windowEndsAt: number = 0;

    /**
     * How many entries were written as rows of their own this minute.
     */
    private written: number = 0;

    /**
     * The kinds counted this minute, by what makes them one kind.
     */
    private readonly collapsed: Map<string, CollapsedLog> = new Map();

    /**
     * What is past the kinds kept apart, per level.
     */
    private readonly overflow: Map<LogLevel, CollapsedLog> = new Map();

    /**
     * The timer writing the counted rows when the minute ends, if anything was counted.
     */
    private windowEnd: NodeJS.Timeout | undefined;

    /**
     * Creates a budget.
     * @param maxEntriesPerMinute - How many entries a minute are written as rows of their own.
     * @param writeLogs - Writes rows.
     */
    constructor(
        private readonly maxEntriesPerMinute: number,
        private readonly writeLogs: (logs: Log[]) => Promise<void>
    ) {}

    /**
     * Writes what the budget admits, and counts the rest.
     * @param logs - The entries, oldest first.
     */
    async write(logs: Log[]): Promise<void> {
        const now: number = Date.now();
        const rows: Log[] = [];
        if (now >= this.windowEndsAt) {
            // the previous minute's counts, should this arrive before its timer wrote them
            rows.push(...this.takeCollapsed());
            this.windowEndsAt = now + Ms.MINUTE;
            this.written = 0;
        }

        const admitted: Set<Log> = this.resolveAdmitted(logs);
        for (const log of logs) {
            if (admitted.has(log)) {
                rows.push(log);
                continue;
            }
            this.collapse(log);
        }
        this.written += admitted.size;
        this.scheduleWindowEnd(now);

        if (rows.length) {
            await this.writeLogs(rows);
        }
    }

    /**
     * Writes what was counted so far, without waiting for the minute to end.
     */
    async flush(): Promise<void> {
        clearTimeout(this.windowEnd);
        this.windowEnd = undefined;
        const rows: Log[] = this.takeCollapsed();
        if (rows.length) {
            await this.writeLogs(rows);
        }
    }

    /**
     * Resolves which entries of a batch get a row of their own.
     * @param logs - The batch.
     * @returns The entries that fit in what is left of the budget.
     */
    private resolveAdmitted(logs: Log[]): Set<Log> {
        const left: number = Math.max(this.maxEntriesPerMinute - this.written, 0);
        if (logs.length <= left) {
            return new Set(logs);
        }
        // most important first, so an error in a batch of info lines keeps its row. The sort is
        // stable, so among equals the earlier entry does
        return new Set([...logs].sort((a, b) => b.level - a.level).slice(0, left));
    }

    /**
     * Counts an entry into the row of its kind.
     * @param log - The entry past the budget.
     */
    private collapse(log: Log): void {
        // the metadata rather than the audit event's fields alone: two entries whose metadata differ
        // say different things, and counting them as one would keep only what the first said
        const kind: string = JsonUtilities.stringify([log.tenantId, log.level, log.message, log.context.metadata]);
        const known: CollapsedLog | undefined = this.collapsed.get(kind);
        if (known) {
            known.count++;
            known.lastAt = log.createdAt;
            return;
        }
        // bounded, because a message echoing input makes every entry a kind of its own
        if (this.collapsed.size < maxCollapsedKinds) {
            this.collapsed.set(kind, { log, count: 1, lastAt: log.createdAt });
            return;
        }
        const overflow: CollapsedLog | undefined = this.overflow.get(log.level);
        if (overflow) {
            overflow.count++;
            overflow.lastAt = log.createdAt;
            return;
        }
        this.overflow.set(log.level, {
            log: {
                id: UUIDUtilities.generate(),
                level: log.level,
                message: overflowMessage,
                createdAt: log.createdAt,
                // the retention of the level, which every entry it counts shares
                cleanupAt: log.cleanupAt,
                // no tenant, since it counts the entries of every tenant
                context: { origin: 'DbLoggerTransport' }
            },
            count: 1,
            lastAt: log.createdAt
        });
    }

    /**
     * Removes and returns the rows counted so far.
     * @returns One row per kind, then one per level for what was past the kinds kept apart.
     */
    private takeCollapsed(): Log[] {
        const res: Log[] = [...this.collapsed.values(), ...this.overflow.values()].map(c => ({
            ...c.log,
            context: { ...c.log.context, collapsed: { count: c.count, lastAt: c.lastAt } }
        }));
        this.collapsed.clear();
        this.overflow.clear();
        return res;
    }

    /**
     * Arranges for the counted rows to be written when the minute ends, unless that is arranged.
     *
     * Unref'd, so it never holds the process open. Shutdown flushes the logger, which writes them.
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
     * Writes the counted rows once the minute has ended, never rejecting.
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
            console.error('There was an error when writing the log entries counted past the budget', error);
        }
    }
}