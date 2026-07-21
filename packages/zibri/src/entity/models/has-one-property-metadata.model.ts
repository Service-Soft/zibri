import { OmitStrict } from '../../types/omit-strict.type';
import { BaseEntity } from '../base-entity.model';
import { BaseRelationMetadata } from './base-relation-metadata.model';
import { Relation } from './relation.enum';

/**
 * Metadata for has one properties.
 */
export type HasOnePropertyMetadata<T extends BaseEntity> = BaseRelationMetadata<T> & {
    /**
     * The type of the property.
     */
    type: Relation.HAS_ONE
};

/**
 * Input Metadata for has one properties.
 */
export type HasOnePropertyMetadataInput<T extends BaseEntity> = Partial<OmitStrict<HasOnePropertyMetadata<T>, 'type'>>
    & Pick<HasOnePropertyMetadata<T>, 'target' | 'inverseSide'>;