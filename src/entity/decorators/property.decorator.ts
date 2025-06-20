import { warn } from '../../logging/logger.helpers';
import { Newable } from '../../types';
import { MetadataUtilities } from '../../utilities';
import { ArrayPropertyItemMetadata, ArrayPropertyItemMetadataInput, ArrayPropertyMetadata, ArrayPropertyMetadataInput, BaseEntity, BooleanPropertyMetadata, BooleanPropertyMetadataInput, DatePropertyMetadata, DatePropertyMetadataInput, FilePropertyMetadata, FilePropertyMetadataInput, ManyToManyPropertyMetadata, ManyToManyPropertyMetadataInput, ManyToOnePropertyMetadata, ManyToOnePropertyMetadataInput, NumberPropertyMetadata, NumberPropertyMetadataInput, ObjectPropertyMetadata, ObjectPropertyMetadataInput, OneToManyPropertyMetadata, OneToManyPropertyMetadataInput, OneToOnePropertyMetadata, OneToOnePropertyMetadataInput, Relation, StringPropertyMetadata, StringPropertyMetadataInput } from '../models';

export type PropertyMetadata = StringPropertyMetadata
    | NumberPropertyMetadata
    | ObjectPropertyMetadata
    | ArrayPropertyMetadata
    | DatePropertyMetadata
    | BooleanPropertyMetadata
    | FilePropertyMetadata
    | RelationMetadata<BaseEntity>;

export type RelationMetadata<T extends BaseEntity> = ManyToOnePropertyMetadata<T>
    | OneToManyPropertyMetadata<T>
    | OneToOnePropertyMetadata<T>
    | ManyToManyPropertyMetadata<T>;

export type PropertyMetadataInput = StringPropertyMetadataInput
    | NumberPropertyMetadataInput
    | ObjectPropertyMetadataInput
    | ArrayPropertyMetadataInput
    | DatePropertyMetadataInput
    | FilePropertyMetadataInput
    | BooleanPropertyMetadataInput;

export type RelationMetadataInput<T extends BaseEntity> = ManyToOnePropertyMetadataInput<T>
    | OneToManyPropertyMetadataInput<T>
    | OneToOnePropertyMetadataInput<T>
    | ManyToManyPropertyMetadataInput<T>;

// eslint-disable-next-line typescript/no-namespace
export namespace Property {
    export function string(data?: StringPropertyMetadataInput): PropertyDecorator {
        const fullMetadata: StringPropertyMetadata = {
            required: true,
            primary: false,
            type: 'string',
            unique: false,
            description: undefined,
            format: data?.primary === true ? 'uuid' : undefined,
            maxLength: undefined,
            minLength: undefined,
            ...data
        };
        return applyData(fullMetadata);
    }

    export function number(data?: NumberPropertyMetadataInput): PropertyDecorator {
        const fullMetadata: NumberPropertyMetadata = {
            required: true,
            primary: false,
            unique: false,
            type: 'number',
            description: undefined,
            ...data
        };
        return applyData(fullMetadata);
    }

    export function boolean(data?: BooleanPropertyMetadataInput): PropertyDecorator {
        const fullMetadata: BooleanPropertyMetadata = {
            required: true,
            type: 'boolean',
            description: undefined,
            ...data
        };
        return applyData(fullMetadata);
    }

    export function date(data?: DatePropertyMetadataInput): PropertyDecorator {
        const fullMetadata: DatePropertyMetadata = {
            required: true,
            type: 'date',
            description: undefined,
            ...data
        };
        return applyData(fullMetadata);
    }

    export function object(data: ObjectPropertyMetadataInput): PropertyDecorator {
        const fullMetadata: ObjectPropertyMetadata = {
            required: true,
            type: 'object',
            description: undefined,
            ...data
        };
        return applyData(fullMetadata);
    }

    export function file(data?: FilePropertyMetadataInput): PropertyDecorator {
        return (target, key) => {
            if (data?.allowedMimeTypes == undefined) {
                warn(
                    `Did not specify allowedMimeTypes on property "${target.constructor.name}.${key.toString()}"`,
                    'Defaults to allowing any file type.'
                );
            }
            const fullMetadata: FilePropertyMetadata = {
                required: true,
                type: 'file',
                description: undefined,
                allowedMimeTypes: 'all',
                maxSize: '5mb',
                ...data
            };
            const ctor: Newable<unknown> = target.constructor as Newable<unknown>;
            // eslint-disable-next-line unicorn/error-message
            const stack: string = new Error().stack ?? '';
            MetadataUtilities.setFilePath(ctor, stack);
            const propertyMetadata: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(ctor);
            propertyMetadata[key as string] = fullMetadata;
            MetadataUtilities.setModelProperties(ctor, propertyMetadata);
        };
    }

    export function array(data: ArrayPropertyMetadataInput): PropertyDecorator {
        return (target, key) => {
            const fullMetadata: ArrayPropertyMetadata = {
                required: true,
                type: 'array',
                description: undefined,
                ...data,
                items: fillArrayItemPropertyMetadata(data.items, target, key.toString())
            };
            const ctor: Newable<unknown> = target.constructor as Newable<unknown>;
            // eslint-disable-next-line unicorn/error-message
            const stack: string = new Error().stack ?? '';
            MetadataUtilities.setFilePath(ctor, stack);
            const propertyMetadata: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(ctor);
            propertyMetadata[key as string] = fullMetadata;
            MetadataUtilities.setModelProperties(ctor, propertyMetadata);
        };
    }

    export function manyToOne<T extends BaseEntity>(metadata: ManyToOnePropertyMetadataInput<T>): PropertyDecorator {
        const fullMetadata: ManyToOnePropertyMetadata<T> = {
            required: true,
            type: Relation.MANY_TO_ONE,
            cascade: ['remove'],
            inverseSide: undefined,
            description: undefined,
            persistence: false,
            ...metadata
        };
        return applyData(fullMetadata as PropertyMetadata);
    }

    export function oneToMany<T extends BaseEntity>(metadata: OneToManyPropertyMetadataInput<T>): PropertyDecorator {
        const fullMetadata: OneToManyPropertyMetadata<T> = {
            required: true,
            type: Relation.ONE_TO_MANY,
            cascade: ['remove'],
            inverseSide: undefined,
            description: undefined,
            persistence: false,
            ...metadata
        };
        return applyData(fullMetadata as PropertyMetadata);
    }

    export function oneToOne<T extends BaseEntity>(metadata: OneToOnePropertyMetadataInput<T>): PropertyDecorator {
        const fullMetadata: OneToOnePropertyMetadata<T> = {
            required: true,
            type: Relation.ONE_TO_ONE,
            cascade: ['remove'],
            inverseSide: undefined,
            description: undefined,
            persistence: false,
            ...metadata
        };
        return applyData(fullMetadata as PropertyMetadata);
    }

    export function manyToMany<T extends BaseEntity>(metadata: ManyToManyPropertyMetadataInput<T>): PropertyDecorator {
        const fullMetadata: ManyToManyPropertyMetadata<T> = {
            required: true,
            type: Relation.MANY_TO_MANY,
            cascade: [],
            inverseSide: undefined,
            description: undefined,
            persistence: false,
            ...metadata
        };
        return applyData(fullMetadata as PropertyMetadata);
    }
}

function applyData(data: PropertyMetadata): PropertyDecorator {
    return (target, key) => {
        const ctor: Newable<unknown> = target.constructor as Newable<unknown>;
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(ctor, stack);
        const propertyMetadata: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(ctor);
        propertyMetadata[key as string] = data;
        MetadataUtilities.setModelProperties(ctor, propertyMetadata);
    };
}

function fillArrayItemPropertyMetadata(
    data: ArrayPropertyItemMetadataInput,
    target: Object,
    key: string
): ArrayPropertyItemMetadata {
    switch (data.type) {
        case 'number': {
            return {
                required: true,
                primary: false,
                unique: false,
                description: undefined,
                ...data,
                type: data.type
            };
        }
        case 'string': {
            return {
                required: true,
                primary: false,
                unique: false,
                format: undefined,
                description: undefined,
                maxLength: undefined,
                minLength: undefined,
                ...data,
                type: data.type
            };
        }
        case 'boolean':
        case 'date': {
            return {
                required: true,
                description: undefined,
                ...data,
                type: data.type
            };
        }
        case 'object': {
            const m: ObjectPropertyMetadataInput = data as ObjectPropertyMetadata;
            return {
                required: true,
                description: undefined,
                ...m,
                type: data.type
            };
        }
        case 'array': {
            const m: ArrayPropertyMetadataInput = data as ArrayPropertyMetadataInput;
            return {
                required: true,
                description: undefined,
                ...m,
                type: data.type,
                items: fillArrayItemPropertyMetadata(m.items, target, key)
            };
        }
        case 'file': {
            const m: FilePropertyMetadataInput = data as FilePropertyMetadataInput;
            if (m.allowedMimeTypes == undefined) {
                warn(
                    `Did not specify allowedMimeTypes on property "${target.constructor.name}.${key.toString()}"`,
                    'Defaults to allowing any file type.'
                );
            }
            return {
                required: true,
                description: undefined,
                allowedMimeTypes: 'all',
                maxSize: '5mb',
                ...m,
                type: data.type
            };
        }
    }
}