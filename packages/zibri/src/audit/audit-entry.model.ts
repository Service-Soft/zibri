import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { AuditAction, AuditOutcome, AuditReason } from '../logging/audit-event.model';
import { OmitStrict } from '../types/omit-strict.type';

/**
 * How an entry stands for the refusals past the minute's budget.
 */
export enum AuditCollapse {
    /**
     * Every refusal of one kind: the same tenant, action, reason, subject, user, role, scopes and
     * address. The entry carries what they share.
     */
    PER_KIND = 'per-kind',
    /**
     * Every refusal of one action and reason past the kinds kept apart. The entry carries only those two.
     */
    PAST_KINDS = 'past-kinds'
}

/**
 * One entry of the audit trail.
 */
@Entity({ allowOrphan: true, defaultOrder: { occurredAt: 'ASC' } })
export class AuditEntry extends BaseEntity {
    /**
     * The tenant the event happened in, or null for one outside every tenant.
     */
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string | null;
    /**
     * What was attempted.
     */
    @Property.string({ enum: AuditAction })
    action!: AuditAction;
    /**
     * Whether it happened.
     */
    @Property.string({ enum: AuditOutcome })
    outcome!: AuditOutcome;
    /**
     * Why it did not, when it did not.
     */
    @Property.string({ enum: AuditReason, required: false })
    reason?: AuditReason | null;
    /**
     * The account the attempt named, as the caller spelled it.
     */
    @Property.string({ required: false })
    subject?: string | null;
    /**
     * The id of the account, once the attempt got far enough to resolve one.
     */
    @Property.string({ required: false })
    userId?: string | null;
    /**
     * The scopes of a provider's apis the access granted or revoked covers.
     */
    @Property.array({ items: { type: 'string' }, required: false })
    scopes?: string[] | null;
    /**
     * The role created, changed, deleted, given or taken.
     */
    @Property.string({ required: false })
    role?: string | null;
    /**
     * The address of the client the request came from, for an event recorded while handling one.
     */
    @Property.string({ required: false })
    clientIp?: string | null;
    /**
     * The trace of the request the event was recorded in, for an event recorded while handling one.
     */
    @Property.string({ required: false })
    traceId?: string | null;
    /**
     * When the event happened, or the first of the refusals the entry stands for.
     */
    @Property.date()
    occurredAt!: Date;
    /**
     * When the last of the refusals the entry stands for happened. The same as `occurredAt` for one event.
     */
    @Property.date()
    lastOccurredAt!: Date;
    /**
     * How many events the entry stands for. 1 unless it is collapsed.
     */
    @Property.number({ format: 'integer' })
    count!: number;
    /**
     * How the entry stands for refusals past the minute's budget, or nothing for an entry of one event.
     */
    @Property.string({ enum: AuditCollapse, required: false })
    collapsed?: AuditCollapse | null;
}

/**
 * The data an audit entry is created with.
 */
export type AuditEntryCreateData = OmitStrict<AuditEntry, 'id'>;