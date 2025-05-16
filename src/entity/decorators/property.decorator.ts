import { MetadataUtilities } from '../../utilities';
import { ArrayPropertyMetadata, ArrayPropertyMetadataInput, DatePropertyMetadata, DatePropertyMetadataInput, NumberPropertyMetadata, NumberPropertyMetadataInput, ObjectPropertyMetadata, ObjectPropertyMetadataInput, StringPropertyMetadata, StringPropertyMetadataInput } from '../models';

export type PropertyMetadata = StringPropertyMetadata
    | NumberPropertyMetadata
    | ObjectPropertyMetadata
    | ArrayPropertyMetadata
    | DatePropertyMetadata;

export type PropertyMetadataInput = StringPropertyMetadataInput
    | NumberPropertyMetadataInput
    | ObjectPropertyMetadataInput
    | ArrayPropertyMetadataInput
    | DatePropertyMetadataInput;

export function Property(data: PropertyMetadataInput): PropertyDecorator {
    const fullMetadata: PropertyMetadata = fillPropertyMetadata(data);
    return (target, key) => {
        const ctor: Function = target.constructor;
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(ctor, stack);
        const propertyMetadata: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(ctor);
        propertyMetadata[key as string] = fullMetadata;
        MetadataUtilities.setModelProperties(ctor, propertyMetadata);
    };
}

function fillPropertyMetadata(data: PropertyMetadataInput): PropertyMetadata {
    switch (data.type) {
        case 'number':
        case 'string': {
            return {
                required: true,
                primary: false,
                ...data
            };
        }
        case 'date':
        case 'object':
        case 'array': {
            return {
                required: true,
                ...data
            };
        }
    }
}