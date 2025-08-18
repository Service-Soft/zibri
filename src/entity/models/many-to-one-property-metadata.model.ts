import { BaseRelationMetadata } from './base-relation-metadata.model';
import { Relation } from './relation.enum';
import { OmitStrict } from '../../types';
import { BaseEntity } from '../decorators';

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
    & Pick<ManyToOnePropertyMetadata<T>, 'target' | 'inverseSide'>;