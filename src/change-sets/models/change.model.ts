import { ChangeSet } from './change-set.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * Defines a single value change of an change set.
 */
@Entity()
export class Change<T = unknown> extends BaseEntity {
    /**
     * The key of the value that has been changed.
     */
    @Property.string()
    key!: string;
    /**
     * The value before it was changed.
     */
    @Property.unknown({ required: false })
    previousValue?: T | null;
    /**
     * The value after it was changed.
     */
    @Property.unknown({ required: false })
    newValue?: T | null;
    /**
     * The change set that this change belongs to.
     */
    @Property.manyToOne({ target: () => ChangeSet, inverseSide: 'changes', joinColumn: 'changeSetId' })
    changeSet!: ChangeSet;
    /**
     * The id of the change set that this change belongs to.
     */
    @Property.string({ format: 'uuid' })
    changeSetId!: string;
}

/**
 * The data required to create a change.
 */
export type CreateChangeData = OmitStrict<Change, 'id'>;

/**
 * A new change.
 */
export type NewChange = OmitStrict<Change, 'id' | 'changeSetId' | 'changeSet'>;