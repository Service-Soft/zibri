import { OmitStrict } from '../../types/omit-strict.type.ts';
import { BaseEntity } from '../base-entity.model.ts';
import { BaseRelationMetadata } from './base-relation-metadata.model.ts';
import { RelationType } from './relation-type.enum.ts';

/**
 * Metadata for has one properties.
 */
export type HasOnePropertyMetadata<T extends BaseEntity> = BaseRelationMetadata<T> & {
    /**
     * The type of the property.
     */
    type: RelationType.HAS_ONE
};

/**
 * Input Metadata for has one properties.
 */
export type HasOnePropertyMetadataInput<T extends BaseEntity> = Partial<OmitStrict<HasOnePropertyMetadata<T>, 'type'>>
    & Pick<HasOnePropertyMetadata<T>, 'target' | 'inverseSide'>;