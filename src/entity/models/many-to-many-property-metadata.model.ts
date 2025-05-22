import { BaseEntity, Relation } from '..';
import { BaseRelationMetadata } from './base-relation-metadata.model';
import { OmitStrict } from '../../types';

export type ManyToManyPropertyMetadata<T extends BaseEntity> = BaseRelationMetadata<T> & {
    type: Relation.MANY_TO_MANY
};

export type ManyToManyPropertyMetadataInput<T extends BaseEntity> = Partial<OmitStrict<ManyToManyPropertyMetadata<T>, 'type'>>
    & Pick<ManyToManyPropertyMetadata<T>, 'target'>;