import { Newable } from '../../types';
import { PropertyMetadata } from '../decorators';

export type ArrayPropertyMetadata = {
    required: boolean,
    type: 'array',
    itemType: Exclude<PropertyMetadata['type'], 'object' | 'array'> | Newable<unknown>
};

export type ArrayPropertyMetadataInput = Partial<ArrayPropertyMetadata> & Pick<ArrayPropertyMetadata, 'type' | 'itemType'>;