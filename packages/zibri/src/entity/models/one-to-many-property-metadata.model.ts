import { BaseRelationMetadata } from './base-relation-metadata.model.ts';
import { RelationType } from './relation-type.enum.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';
import { type BaseEntity } from '../base-entity.model.ts';

/**
 * Metadata for one to many properties.
 */
export type OneToManyPropertyMetadata<T extends BaseEntity> = BaseRelationMetadata<T> & {
    /**
     * The type of the property.
     */
    type: RelationType.ONE_TO_MANY
};

/**
 * Input Metadata for one to many properties.
 */
export type OneToManyPropertyMetadataInput<T extends BaseEntity> = Partial<OmitStrict<OneToManyPropertyMetadata<T>, 'type'>>
    & Pick<OneToManyPropertyMetadata<T>, 'target' | 'inverseSide'>;