import { BaseRelationMetadata } from './base-relation-metadata.model';
import { Relation } from './relation.enum';
import { type DeletedRelatedRows } from '../../data-source/models/deleted-related-rows.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { type BaseEntity } from '../base-entity.model';

/**
 * Metadata for one to many properties.
 */
export type OneToManyPropertyMetadata<T extends BaseEntity> = BaseRelationMetadata<T> & {
    /**
     * The type of the property.
     */
    type: Relation.ONE_TO_MANY,
    /**
     * What a write does with a soft deleted row it is given by its id. A write's own
     * `deletedRelatedRows` decides instead.
     * @default 'refuse'
     */
    deletedRows: DeletedRelatedRows
};

/**
 * Input Metadata for one to many properties.
 */
export type OneToManyPropertyMetadataInput<T extends BaseEntity> = Partial<OmitStrict<OneToManyPropertyMetadata<T>, 'type'>>
    & Pick<OneToManyPropertyMetadata<T>, 'target' | 'inverseSide'>;