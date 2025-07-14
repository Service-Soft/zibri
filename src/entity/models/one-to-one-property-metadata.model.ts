import { BaseEntity, Relation } from '..';
import { BaseRelationMetadata } from './base-relation-metadata.model';
import { OmitStrict } from '../../types';

/**
 * Metadata for one to one properties.
 */
export type OneToOnePropertyMetadata<T extends BaseEntity> = BaseRelationMetadata<T> & {
    /**
     * The type of the property.
     */
    type: Relation.ONE_TO_ONE
};

/**
 * Input Metadata for one to one properties.
 */
export type OneToOnePropertyMetadataInput<T extends BaseEntity> = Partial<OmitStrict<OneToOnePropertyMetadata<T>, 'type'>>
    & Pick<OneToOnePropertyMetadata<T>, 'target'>;