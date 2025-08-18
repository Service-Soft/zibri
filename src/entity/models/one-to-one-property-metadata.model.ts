import { BaseRelationMetadata } from './base-relation-metadata.model';
import { Relation } from './relation.enum';
import { OmitStrict } from '../../types';
import { BaseEntity } from '../decorators';

/**
 * Metadata for one to one properties.
 */
export type OneToOnePropertyMetadata<T extends BaseEntity> = BaseRelationMetadata<T> & {
    /**
     * The type of the property.
     */
    type: Relation.ONE_TO_ONE,
    /**
     * Whether or not this entity has a join column.
     */
    joinColumn: boolean
};

/**
 * Input Metadata for one to one properties.
 */
export type OneToOnePropertyMetadataInput<T extends BaseEntity> = Partial<OmitStrict<OneToOnePropertyMetadata<T>, 'type'>>
    & Pick<OneToOnePropertyMetadata<T>, 'target' | 'inverseSide' | 'cascade'>;

/**
 * Input Metadata for has one properties.
 */
export type HasOnePropertyMetadataInput<T extends BaseEntity> = OmitStrict<OneToOnePropertyMetadataInput<T>, 'cascade' | 'joinColumn'> &
    Partial<Pick<OneToOnePropertyMetadataInput<T>, 'cascade'>>;

/**
 * Input Metadata for belongs to one properties.
 */
export type BelongsToOnePropertyMetadataInput<T extends BaseEntity> = HasOnePropertyMetadataInput<T>;