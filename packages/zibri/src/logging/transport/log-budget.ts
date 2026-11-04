import { JsonUtilities } from '../../utilities/json.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { MAX_COLLAPSED_KINDS, WriteBudget } from '../../utilities/write-budget';
import { Log } from '../log.model';

/**
 * The message of the row counting what is past the kinds kept apart.
 */
const overflowMessage: string = `entries past the log budget, beyond the first ${MAX_COLLAPSED_KINDS} kinds`;

/**
 * Bounds how many rows a transport writes in a minute.
 *
 * Within the budget every entry is a row of its own. Past it, entries of the same tenant, level,
 * message and metadata are counted into one row per kind, written when the minute ends or when the
 * logger is flushed. At most a hundred kinds are kept apart; the rest are counted in one row per level.
 */
export class LogBudget extends WriteBudget<Log> {

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected resolveKind(log: Log): string {
        // the metadata rather than the audit event's fields alone: two entries whose metadata differ
        // say different things, and counting them as one would keep only what the first said
        return JsonUtilities.stringify([log.tenantId, log.level, log.message, log.context.metadata]);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected resolveOverflowKind(log: Log): string {
        return String(log.level);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected resolveImportance(log: Log): number {
        return log.level;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected getOccurredAt(log: Log): Date {
        return log.createdAt;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected toCollapsed(first: Log, count: number, lastAt: Date): Log {
        return { ...first, context: { ...first.context, collapsed: { count, lastAt } } };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected toOverflow(first: Log, count: number, lastAt: Date): Log {
        return {
            id: UUIDUtilities.generate(),
            // no tenant, since it counts the entries of every tenant. Null, since the write fills an
            // undefined one with the tenant it runs in
            tenantId: null,
            level: first.level,
            message: overflowMessage,
            createdAt: first.createdAt,
            // the retention of the level, which every entry it counts shares
            cleanupAt: first.cleanupAt,
            context: { origin: 'DbLoggerTransport', collapsed: { count, lastAt } }
        };
    }
}