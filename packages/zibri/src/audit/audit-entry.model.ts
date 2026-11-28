import { FrameworkColumnRegistry } from '../data-source/migration/framework-column.registry';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitStrict } from '../types/omit-strict.type';
import { BaseAuditEntry } from './base-audit-entry.model';

/**
 * One entry of the audit trail. Each carries a keyed hash of what it holds, and each hour of entries
 * is sealed in an `AuditCheckpoint`, which together tell an entry that was changed, removed or
 * slipped in apart from the recorded ones.
 */
@Entity({ allowOrphan: true, appendOnly: true, defaultOrder: { occurredAt: 'ASC' } })
export class AuditEntry extends BaseAuditEntry {
    /**
     * When the entry was stored, which decides the checkpoint that seals it.
     */
    @Property.date({ index: true })
    recordedAt!: Date;
    /**
     * The keyed hash of everything else the entry holds.
     */
    @Property.string()
    mac!: string;
}

// added by the data source to a table that lacks them, so that a trail of 3.2 takes no migration of the
// application's. An entry stored before holds neither, and its hash, which leaves an added column holding nothing
// out, stays what it was
FrameworkColumnRegistry.register(
    { entity: AuditEntry, property: 'userKind', meansAbsent: value => value === 'person' },
    { entity: AuditEntry, property: 'approvalRequestId' }
);

/**
 * The data an audit entry is created with.
 */
export type AuditEntryCreateData = OmitStrict<AuditEntry, 'id'>;