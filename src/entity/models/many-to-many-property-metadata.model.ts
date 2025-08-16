import { BaseEntity } from './base-entity.model';
import { BaseRelationMetadata } from './base-relation-metadata.model';
import { Relation } from './relation.enum';
import { OmitStrict } from '../../types';

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
    joinTable: boolean
};

/**
 * Input Metadata for many to many properties.
 */
export type ManyToManyPropertyMetadataInput<T extends BaseEntity> = Partial<OmitStrict<ManyToManyPropertyMetadata<T>, 'type'>>
    & Pick<ManyToManyPropertyMetadata<T>, 'target' | 'joinTable' | 'inverseSide'>;