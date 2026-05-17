import { BaseRelationMetadata } from './base-relation-metadata.model';
import { Relation } from './relation.enum';
import { OmitStrict } from '../../types/omit-strict.type';
import { type BaseEntity } from '../base-entity.model';

/**
 * Metadata for many to one properties.
 */
export type ManyToOnePropertyMetadata<T extends BaseEntity> = BaseRelationMetadata<T> & {
    /**
     * The type of the property.
     */
    type: Relation.MANY_TO_ONE,
    /**
     * The column on the current entity that holds the foreign key.
     */
    joinColumn: string | undefined
};

/**
 * Input Metadata for many to one properties.
 */
export type ManyToOnePropertyMetadataInput<
    T extends BaseEntity,
    TJoinKey extends string
> = Partial<OmitStrict<ManyToOnePropertyMetadata<T>, 'type' | 'joinColumn'>>
    & Pick<ManyToOnePropertyMetadata<T>, 'target' | 'inverseSide'>
    & {
        /**
         * The column on the current entity that holds the foreign key.
         * Must be an existing key on the decorated class.
         */
        joinColumn?: TJoinKey
    };