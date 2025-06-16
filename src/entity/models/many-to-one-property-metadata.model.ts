import { BaseRelationMetadata } from './base-relation-metadata.model';
import { BaseEntity, Relation } from '../../entity';
import { OmitStrict } from '../../types';

export type ManyToOnePropertyMetadata<T extends BaseEntity> = BaseRelationMetadata<T> & {
    type: Relation.MANY_TO_ONE
};

export type ManyToOnePropertyMetadataInput<T extends BaseEntity> = Partial<OmitStrict<ManyToOnePropertyMetadata<T>, 'type'>>
    & Pick<ManyToOnePropertyMetadata<T>, 'target'>;