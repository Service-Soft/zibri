import { Newable } from '../../types';

export type ObjectPropertyMetadata = {
    required: boolean,
    type: 'object',
    cls: Newable<unknown>
};

export type ObjectPropertyMetadataInput = Partial<ObjectPropertyMetadata> & Pick<ObjectPropertyMetadata, 'type' | 'cls'>;