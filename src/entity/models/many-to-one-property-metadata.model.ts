import { BaseRelationMetadata } from './base-relation-metadata.model';
import { BaseEntity, Relation } from '../../entity';
import { OmitStrict } from '../../types';

/**
 * Metadata for many to one properties.
 */
export type ManyToOnePropertyMetadata<T extends BaseEntity> = BaseRelationMetadata<T> & {
    /**
     * The type of the property.
     */
    type: Relation.MANY_TO_ONE
};

/**
 * Input Metadata for many to one properties.
 */
export type ManyToOnePropertyMetadataInput<T extends BaseEntity> = Partial<OmitStrict<ManyToOnePropertyMetadata<T>, 'type'>>
    & Pick<ManyToOnePropertyMetadata<T>, 'target'>;