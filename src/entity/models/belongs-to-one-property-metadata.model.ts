import { OmitStrict } from '../../types/omit-strict.type';
import { BaseEntity } from '../base-entity.model';
import { BaseRelationMetadata } from './base-relation-metadata.model';
import { Relation } from './relation.enum';

/**
 * Metadata for belongs to one properties.
 */
export type BelongsToOnePropertyMetadata<T extends BaseEntity> = BaseRelationMetadata<T> & {
    /**
     * The type of the property.
     */
    type: Relation.BELONGS_TO_ONE,
    /**
     * The column on the current entity that holds the foreign key.
     */
    joinColumn: string | undefined
};

/**
 * Input Metadata for belongs to one properties.
 */
export type BelongsToOnePropertyMetadataInput<
    T extends BaseEntity,
    TJoinKey extends string
> = Partial<OmitStrict<BelongsToOnePropertyMetadata<T>, 'type'>>
    & Pick<BelongsToOnePropertyMetadata<T>, 'target' | 'inverseSide'>
    & {
        /**
         * The column on the current entity that holds the foreign key.
         * Must be an existing key on the decorated class.
         */
        joinColumn?: TJoinKey
    };