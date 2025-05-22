import { BaseRelationMetadata } from './base-relation-metadata.model';
import { BaseEntity, Relation } from '../../entity';
import { OmitStrict } from '../../types';

export type OneToManyPropertyMetadata<T extends BaseEntity> = BaseRelationMetadata<T> & {
    type: Relation.ONE_TO_MANY
};

export type OneToManyPropertyMetadataInput<T extends BaseEntity> = Partial<OmitStrict<OneToManyPropertyMetadata<T>, 'type'>>
    & Pick<OneToManyPropertyMetadata<T>, 'target'>;