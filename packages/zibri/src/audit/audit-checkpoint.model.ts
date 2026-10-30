import { BaseChainedEntity } from '../data-source/chain/base-chained-entity.model';
import { whereFor } from '../data-source/models/where/where-for.function';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitStrict } from '../types/omit-strict.type';

/**
 * Seals the audit entries of one tenant stored in a span of time: how many there are and a digest of
 * their keyed hashes. The checkpoints of each tenant form a chain and follow each other without a gap,
 * so an entry removed from a sealed span is told apart, and so is a checkpoint removed.
 */
@Entity({
    allowOrphan: true,
    chained: true,
    defaultOrder: { chainSequence: 'ASC' },
    // one checkpoint per tenant and span, so two instances sealing at once cannot seal a span twice
    uniques: [
        ['tenantId', 'periodEnd'],
        // eslint-disable-next-line unicorn/no-null
        { properties: ['periodEnd'], where: whereFor<AuditCheckpoint>({ tenantId: null }) }
    ]
})
export class AuditCheckpoint extends BaseChainedEntity {
    /**
     * The tenant whose entries it seals, or null for the entries of no tenant.
     */
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string | null;
    /**
     * Where the sealed span starts: the end of the checkpoint before it, or the first entry it seals.
     */
    @Property.date()
    periodStart!: Date;
    /**
     * Where the sealed span ends. The entries stored from then on belong to the next checkpoint.
     */
    @Property.date()
    periodEnd!: Date;
    /**
     * How many entries were stored in the span.
     */
    @Property.number({ format: 'integer' })
    entryCount!: number;
    /**
     * The digest of the keyed hashes of those entries, in the order they were stored.
     */
    @Property.string()
    digest!: string;
}

/**
 * The data an audit checkpoint is created with.
 */
export type AuditCheckpointCreateData = OmitStrict<AuditCheckpoint, 'id' | 'chainSequence' | 'chainHash'>;