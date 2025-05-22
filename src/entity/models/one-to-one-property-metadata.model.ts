import { BaseEntity, Relation } from '..';
import { BaseRelationMetadata } from './base-relation-metadata.model';
import { OmitStrict } from '../../types';

export type OneToOnePropertyMetadata<T extends BaseEntity> = BaseRelationMetadata<T> & {
    type: Relation.ONE_TO_ONE
};

export type OneToOnePropertyMetadataInput<T extends BaseEntity> = Partial<OmitStrict<OneToOnePropertyMetadata<T>, 'type'>>
    & Pick<OneToOnePropertyMetadata<T>, 'target'>;