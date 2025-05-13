import { MetadataUtilities } from '../../encapsulation';
import { Newable } from '../../types';

type SimpleDataType = 'string' | 'number';

type BasePropertyMetadata = {
    required: boolean
};

export type SimplePropertyMetadata = BasePropertyMetadata & {
    type: SimpleDataType
};

type SimplePropertyMetadataInput = Partial<BasePropertyMetadata> & Pick<SimplePropertyMetadata, 'type'>;

export type ObjectPropertyMetadata = BasePropertyMetadata & {
    type: 'object',
    cls: Newable<unknown>
};

type ObjectPropertyMetadataInput = Partial<BasePropertyMetadata> & Pick<ObjectPropertyMetadata, 'type' | 'cls'>;

export type ArrayPropertyMetadata = BasePropertyMetadata & {
    type: 'array',
    itemType: SimpleDataType | Newable<unknown>
};

type ArrayPropertyMetadataInput = Partial<BasePropertyMetadata> & Pick<ArrayPropertyMetadata, 'type' | 'itemType'>;

export type PropertyMetadata = SimplePropertyMetadata | ObjectPropertyMetadata | ArrayPropertyMetadata;

type PropertyMetadataInput = SimplePropertyMetadataInput | ObjectPropertyMetadataInput | ArrayPropertyMetadataInput;

export function Property(data: PropertyMetadataInput): PropertyDecorator {
    const fullMetadata: PropertyMetadata = {
        required: true,
        ...data
    };
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