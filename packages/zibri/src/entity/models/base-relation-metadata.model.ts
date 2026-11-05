import { BasePropertyMetadata } from './base-property-metadata.model';
import { Newable } from '../../types/newable.type';
import { type BaseEntity } from '../base-entity.model';

/**
 * What a write or a removal of a row does to the rows of a relation: `true` for everything, or the
 * operations named.
 */
export type RelationCascade = boolean | ('insert' | 'update' | 'remove' | 'soft-remove' | 'recover')[];

/**
 * Metadata shared by all relation properties.
 */
export type BaseRelationMetadata<T extends BaseEntity> = BasePropertyMetadata & {
    /**
     * What a write or a removal of a row does to the rows of the relation.
     */
    cascade: RelationCascade,
    /**
     * A function returning the target class,
     * used to avoid circular import issues.
     */
    target: () => Newable<T>,
    /**
     * The name of the inverse property on the target,
     * e.g. 'user' if Posts has `@Property.manyToOne(() => User, 'post')`.
     */
    inverseSide: keyof T
};