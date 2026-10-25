import { AuditCollapse, AuditEntryCreateData } from './audit-entry.model';
import { JsonUtilities } from '../utilities/json.utilities';
import { WriteBudget } from '../utilities/write-budget';

/**
 * Bounds how many refusals a minute are stored as entries of their own.
 *
 * Past the budget, refusals of one kind - the same tenant, action, reason, subject, user, role,
 * scopes and address - are counted into one entry. At most a hundred kinds are kept apart; the rest
 * are counted in one entry per action and reason.
 */
export class AuditBudget extends WriteBudget<AuditEntryCreateData> {

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected resolveKind(entry: AuditEntryCreateData): string {
        return JsonUtilities.stringify([
            entry.tenantId,
            entry.action,
            entry.outcome,
            entry.reason,
            entry.subject,
            entry.userId,
            entry.role,
            entry.scopes,
            entry.clientIp
        ]);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected resolveOverflowKind(entry: AuditEntryCreateData): string {
        // closed sets only, since anything a caller chooses would make the overflow unbounded again
        return JsonUtilities.stringify([entry.action, entry.outcome, entry.reason]);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected resolveImportance(): number {
        return 0;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected getOccurredAt(entry: AuditEntryCreateData): Date {
        return entry.occurredAt;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected toCollapsed(first: AuditEntryCreateData, count: number, lastAt: Date): AuditEntryCreateData {
        // the first one's trace stays, so one of the requests can still be looked up
        return { ...first, count, lastOccurredAt: lastAt, collapsed: AuditCollapse.PER_KIND };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected toOverflow(first: AuditEntryCreateData, count: number, lastAt: Date): AuditEntryCreateData {
        return {
            // no tenant, since it counts the refusals of every tenant. Null, since the write fills an
            // undefined one with the tenant it runs in
            // eslint-disable-next-line unicorn/no-null
            tenantId: null,
            action: first.action,
            outcome: first.outcome,
            reason: first.reason,
            occurredAt: first.occurredAt,
            lastOccurredAt: lastAt,
            count,
            collapsed: AuditCollapse.PAST_KINDS
        };
    }
}