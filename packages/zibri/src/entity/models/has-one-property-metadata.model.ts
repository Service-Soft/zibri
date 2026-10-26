import { type DeletedRelatedRows } from '../../data-source/models/deleted-related-rows.type';
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
    type: Relation.HAS_ONE,
    /**
     * What a write does with a soft deleted row it is given by its id. A write's own
     * `deletedRelatedRows` decides instead.
     * @default 'refuse'
     */
    deletedRows: DeletedRelatedRows
};

/**
 * Input Metadata for has one properties.
 */
export type HasOnePropertyMetadataInput<T extends BaseEntity> = Partial<OmitStrict<HasOnePropertyMetadata<T>, 'type'>>
    & Pick<HasOnePropertyMetadata<T>, 'target' | 'inverseSide'>;