import { BaseRelationMetadata } from './base-relation-metadata.model';
import { Relation } from './relation.enum';
import { OmitStrict } from '../../types';
import { type BaseEntity } from '../base-entity.model';

/**
 * Metadata for many to many properties.
 */
export type ManyToManyPropertyMetadata<T extends BaseEntity> = BaseRelationMetadata<T> & {
    /**
     * The type of the property.
     */
    type: Relation.MANY_TO_MANY,
    /**
     * Whether or not this entity should own the join table.
     */
    joinTable: boolean,
    /**
     * Indicates if persistence is enabled for the relation.
     * By default its enabled, but if you want to avoid any changes
     * in the relation to be reflected in the database you can disable it.
     * If its disabled you can only change a relation from inverse side
     * of a relation or using relation query builder functionality.
     * This is useful for performance optimization since its disabling avoid
     * multiple extra queries during entity save.
     */
    persistence: boolean
};

/**
 * Input Metadata for many to many properties.
 */
export type ManyToManyPropertyMetadataInput<T extends BaseEntity> = Partial<OmitStrict<ManyToManyPropertyMetadata<T>, 'type'>>
    & Pick<ManyToManyPropertyMetadata<T>, 'target' | 'joinTable' | 'inverseSide'>;