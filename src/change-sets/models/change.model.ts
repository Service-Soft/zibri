import { ChangeSet } from './change-set.model';
import { Entity, Property } from '../../entity';
import { BaseEntity } from '../../entity/base-entity.model';
import { OmitStrict } from '../../types';

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
    previousValue?: T;
    /**
     * The value after it was changed.
     */
    @Property.unknown({ required: false })
    newValue?: T;
    /**
     * The change set that this change belongs to.
     */
    @Property.manyToOne({ target: () => ChangeSet, inverseSide: 'changes', required: false })
    changeSet!: ChangeSet;
}

/**
 * The data required to create a change.
 */
export type CreateChangeData = OmitStrict<Change, 'id'>;

/**
 * A new change.
 */
export type NewChange = OmitStrict<Change, 'id' | 'changeSet'>;