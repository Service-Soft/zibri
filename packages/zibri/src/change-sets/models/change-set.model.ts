
import { ChangeSetType } from './change-set-type.enum.ts';
import { Change, NewChange } from './change.model.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';

/**
 * A single change set.
 * Gets automatically created for configured entities whenever they are changed.
 */
@Entity({
    allowOrphan: true,
    allowDuplicate: true,
    defaultOrder: { createdAt: 'ASC' },
    defaultRelations: { changes: true }
})
export class ChangeSet extends BaseEntity {
    /**
     * The tenant of the row this change set describes, or null for a row of no tenant.
     */
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string | null;
    /**
     * Whether this change set was initialized on creating, updating or deleting the entity.
     */
    @Property.string({ enum: ChangeSetType })
    type!: ChangeSetType;
    /**
     * The time at which the change happened with nanosecond precision.
     */
    @Property.number({ format: 'bigint' })
    createdAt!: bigint;
    /**
     * The id of the user that changed something.
     */
    @Property.string({ format: 'uuid', required: false })
    createdBy?: string | null;
    /**
     * The things that have been changed.
     */
    @Property.oneToMany({ target: () => Change, inverseSide: 'changeSet' })
    changes!: Change[];
    /**
     * The id of the related entity that this change set belongs to.
     */
    @Property.string({ format: 'uuid' })
    changeSetEntityId!: string;
}

/**
 * The data required to create a new change set.
 */
export type CreateChangeSetData = OmitStrict<ChangeSet, 'id' | 'changes'> & {
    /**
     * The changes of the changes set.
     */
    changes: NewChange[]
};