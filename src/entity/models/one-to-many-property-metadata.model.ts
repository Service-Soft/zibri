import { BaseRelationMetadata } from './base-relation-metadata.model';
import { Relation } from './relation.enum';
import { OmitStrict } from '../../types/omit-strict.type';
import { type BaseEntity } from '../base-entity.model';

/**
 * Metadata for one to many properties.
 */
export type OneToManyPropertyMetadata<T extends BaseEntity> = BaseRelationMetadata<T> & {
    /**
     * The type of the property.
     */
    type: Relation.ONE_TO_MANY
};

/**
 * Input Metadata for one to many properties.
 */
export type OneToManyPropertyMetadataInput<T extends BaseEntity> = Partial<OmitStrict<OneToManyPropertyMetadata<T>, 'type'>>
    & Pick<OneToManyPropertyMetadata<T>, 'target' | 'inverseSide'>;