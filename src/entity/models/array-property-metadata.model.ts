import { OmitStrict } from '../../types';
import { PropertyMetadata, PropertyMetadataInput, RelationMetadata } from '../decorators';
import { BaseEntity } from './base-entity.model';
import { BasePropertyMetadata } from './base-property-metadata.model';

export type ArrayPropertyMetadata = BasePropertyMetadata & {
    type: 'array',
    items: Exclude<PropertyMetadata, RelationMetadata<BaseEntity>>
};

type ArrayItemPropertyType = Exclude<PropertyMetadata['type'], RelationMetadata<BaseEntity>['type']>;

export type ArrayPropertyItemMetadata = PropertyMetadataInput & { type: ArrayItemPropertyType };

export type ArrayPropertyMetadataInput = Partial<OmitStrict<ArrayPropertyMetadata, 'type' | 'items'>>
    & { items: ArrayPropertyItemMetadata };