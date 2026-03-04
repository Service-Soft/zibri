
import { ChangeSetType } from './change-set-type.enum';
import { Change, NewChange } from './change.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * A single change set.
 * Gets automatically created for configured entities whenever they are changed.
 */
@Entity()
export class ChangeSet extends BaseEntity {
    /**
     * Whether this change set was initialized on creating, updating or deleting the entity.
     */
    @Property.string({ enum: ChangeSetType })
    type!: ChangeSetType;
    /**
     * The time at which the change happened.
     */
    @Property.date()
    createdAt!: Date;
    /**
     * The id of the user that changed something.
     */
    @Property.string({ format: 'uuid', required: false })
    createdBy?: string;
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