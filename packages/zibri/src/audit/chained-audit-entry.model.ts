import { BaseAuditEntry } from './base-audit-entry.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitStrict } from '../types/omit-strict.type';

/**
 * One entry of the audit trail kept with `ZIBRI_DI_TOKENS.AUDIT_INTEGRITY` set to `'chain'`. The
 * entries of each tenant form a chain, which tells an entry that was changed, removed or slipped in
 * apart from the recorded ones.
 */
@Entity({ allowOrphan: true, chained: true, defaultOrder: { occurredAt: 'ASC' } })
export class ChainedAuditEntry extends BaseAuditEntry {
    // declared here rather than inherited from BaseChainedEntity, since the entry already extends the
    // base it shares with AuditEntry - the chain asks for the two properties, not for the class
    /**
     * The place of the entry in the chain of its tenant, counting from 1.
     */
    @Property.number({ format: 'integer' })
    chainSequence!: number;
    /**
     * The keyed hash of the entry's content and of the hash of the entry before it.
     */
    @Property.string()
    chainHash!: string;
}

/**
 * The data a chained audit entry is created with.
 */
export type ChainedAuditEntryCreateData = OmitStrict<ChainedAuditEntry, 'id' | 'chainSequence' | 'chainHash'>;