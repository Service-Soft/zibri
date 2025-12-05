import { warn } from '../../logging/logger.helpers';
import type { Newable } from '../../types';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import type { BaseEntity } from '../base-entity.model';
import type { ArrayPropertyItemMetadata, ArrayPropertyItemMetadataInput, ArrayPropertyMetadata, ArrayPropertyMetadataInput, BelongsToOnePropertyMetadataInput, BooleanPropertyMetadata, BooleanPropertyMetadataInput, DatePropertyMetadata, DatePropertyMetadataInput, HasOnePropertyMetadataInput, ManyToManyPropertyMetadata, ManyToManyPropertyMetadataInput, ManyToOnePropertyMetadata, ManyToOnePropertyMetadataInput, NumberPropertyMetadata, NumberPropertyMetadataInput, ObjectPropertyMetadata, ObjectPropertyMetadataInput, OneToManyPropertyMetadata, OneToManyPropertyMetadataInput, OneToOnePropertyMetadata, OneToOnePropertyMetadataInput, StringPropertyMetadata, StringPropertyMetadataInput, UnknownPropertyMetadata, UnknownPropertyMetadataInput } from '../models';
import type { WithDefaultMetadata } from '../models/base-property-metadata.model';
import type { FilePropertyMetadata, FilePropertyMetadataInput } from '../models/file-property-metadata.model';
import { Relation } from '../models/relation.enum';

/**
 * The metadata of a property.
 */
export type PropertyMetadata = StringPropertyMetadata
    | NumberPropertyMetadata
    | ObjectPropertyMetadata
    | ArrayPropertyMetadata
    | DatePropertyMetadata
    | BooleanPropertyMetadata
    | FilePropertyMetadata
    | UnknownPropertyMetadata
    | RelationMetadata<BaseEntity>;

/**
 * The metadata of relation properties.
 */
export type RelationMetadata<T extends BaseEntity> = ManyToOnePropertyMetadata<T>
    | OneToManyPropertyMetadata<T>
    | OneToOnePropertyMetadata<T>
    | ManyToManyPropertyMetadata<T>;

/**
 * The metadata input to define a property.
 */
export type PropertyMetadataInput = StringPropertyMetadataInput
    | NumberPropertyMetadataInput
    | ObjectPropertyMetadataInput
    | ArrayPropertyMetadataInput
    | DatePropertyMetadataInput
    | FilePropertyMetadataInput
    | BooleanPropertyMetadataInput
    | UnknownPropertyMetadataInput;

/**
 * The metadata input to define a relation property.
 */
export type RelationMetadataInput<T extends BaseEntity> = ManyToOnePropertyMetadataInput<T>
    | OneToManyPropertyMetadataInput<T>
    | OneToOnePropertyMetadataInput<T>
    | HasOnePropertyMetadataInput<T>
    | BelongsToOnePropertyMetadataInput<T>
    | ManyToManyPropertyMetadataInput<T>;

/**
 * Bundles decorators for properties.
 */
// eslint-disable-next-line typescript/no-namespace
export namespace Property {
    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Defines a string property.
     * @param data - Additional data to specify the property.
     */
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
            regex: undefined,
            enum: undefined,
            default: undefined,
            excludeFromChangeSets: false,
            ...data
        };
        return applyData(fullMetadata, data);
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Defines a number property.
     * @param data - Additional data to specify the property.
     */
    export function number(data?: NumberPropertyMetadataInput): PropertyDecorator {
        const fullMetadata: NumberPropertyMetadata = {
            required: true,
            primary: false,
            unique: false,
            type: 'number',
            description: undefined,
            min: undefined,
            max: undefined,
            default: undefined,
            excludeFromChangeSets: false,
            enum: undefined,
            ...data
        };
        return applyData(fullMetadata, data);
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Defines a boolean property.
     * @param data - Additional data to specify the property.
     */
    export function boolean(data?: BooleanPropertyMetadataInput): PropertyDecorator {
        const fullMetadata: BooleanPropertyMetadata = {
            required: true,
            type: 'boolean',
            description: undefined,
            default: undefined,
            excludeFromChangeSets: false,
            ...data
        };
        return applyData(fullMetadata, data);
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Defines a date property.
     * @param data - Additional data to specify the property.
     */
    export function date(data?: DatePropertyMetadataInput): PropertyDecorator {
        const fullMetadata: DatePropertyMetadata = {
            required: true,
            type: 'date',
            description: undefined,
            after: undefined,
            before: undefined,
            default: undefined,
            excludeFromChangeSets: false,
            ...data
        };
        return applyData(fullMetadata, data);
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Defines an object property.
     * @param data - Additional data to specify the property.
     */
    export function object(data: ObjectPropertyMetadataInput): PropertyDecorator {
        const fullMetadata: ObjectPropertyMetadata = {
            required: true,
            type: 'object',
            description: undefined,
            excludeFromChangeSets: false,
            allowAdditionalProperties: false,
            ...data
        };
        return applyData(fullMetadata, data);
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Defines a file property.
     * @param data - Additional data to specify the property.
     */
    export function file(data?: FilePropertyMetadataInput): PropertyDecorator {
        return (target, key) => {
            if (data?.allowedMimeTypes == undefined) {
                warn([
                    `Did not specify allowedMimeTypes on property "${target.constructor.name}.${key.toString()}"`,
                    'Defaults to allowing any file type.'
                ].join('\n'));
            }
            const fullMetadata: FilePropertyMetadata = {
                required: true,
                type: 'file',
                description: undefined,
                allowedMimeTypes: 'all',
                maxSize: '5mb',
                excludeFromChangeSets: false,
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

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Defines an array property.
     * @param data - Additional data to specify the property.
     */
    export function array(data: ArrayPropertyMetadataInput): PropertyDecorator {
        return (target, key) => {
            const fullMetadata: ArrayPropertyMetadata = {
                required: true,
                type: 'array',
                description: undefined,
                excludeFromChangeSets: false,
                totalMaxSize: '50mb',
                ...data,
                items: createArrayItemPropertyMetadata(data.items, `${target.constructor.name}.${key.toString()}`)
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

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Defines an unknown property.
     * @param data - Additional data to specify the property.
     */
    export function unknown(data?: UnknownPropertyMetadataInput): PropertyDecorator {
        const fullMetadata: UnknownPropertyMetadata = {
            required: true,
            type: 'unknown',
            description: undefined,
            excludeFromChangeSets: false,
            ...data
        };
        return applyData(fullMetadata, data);
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Defines a many to one property.
     * @param metadata - Additional data to specify the property.
     */
    export function manyToOne<T extends BaseEntity>(metadata: ManyToOnePropertyMetadataInput<T>): PropertyDecorator {
        const fullMetadata: ManyToOnePropertyMetadata<T> = {
            required: true,
            type: Relation.MANY_TO_ONE,
            cascade: [],
            description: undefined,
            excludeFromChangeSets: false,
            ...metadata
        };
        return applyData(fullMetadata as PropertyMetadata, metadata);
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Defines a one to many property.
     * @param metadata - Additional data to specify the property.
     */
    export function oneToMany<T extends BaseEntity>(metadata: OneToManyPropertyMetadataInput<T>): PropertyDecorator {
        const fullMetadata: OneToManyPropertyMetadata<T> = {
            required: true,
            type: Relation.ONE_TO_MANY,
            cascade: ['remove', 'insert', 'update'],
            description: undefined,
            excludeFromChangeSets: false,
            ...metadata
        };
        return applyData(fullMetadata as PropertyMetadata, metadata);
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Defines a has one property.
     * @param metadata - Additional data to specify the property.
     */
    export function hasOne<T extends BaseEntity>(metadata: HasOnePropertyMetadataInput<T>): PropertyDecorator {
        const fullMetadata: OneToOnePropertyMetadata<T> = {
            required: true,
            type: Relation.ONE_TO_ONE,
            cascade: ['remove', 'insert', 'update'],
            joinColumn: false,
            description: undefined,
            excludeFromChangeSets: false,
            ...metadata
        };
        return applyData(fullMetadata as PropertyMetadata, metadata);
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Defines a belongs to one property.
     * @param metadata - Additional data to specify the property.
     */
    export function belongsToOne<T extends BaseEntity>(metadata: BelongsToOnePropertyMetadataInput<T>): PropertyDecorator {
        const fullMetadata: OneToOnePropertyMetadata<T> = {
            required: true,
            type: Relation.ONE_TO_ONE,
            cascade: [],
            joinColumn: true,
            description: undefined,
            excludeFromChangeSets: false,
            ...metadata
        };
        return applyData(fullMetadata as PropertyMetadata, metadata);
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Defines a many to many property.
     * @param metadata - Additional data to specify the property.
     */
    export function manyToMany<T extends BaseEntity>(metadata: ManyToManyPropertyMetadataInput<T>): PropertyDecorator {
        const fullMetadata: ManyToManyPropertyMetadata<T> = {
            required: true,
            type: Relation.MANY_TO_MANY,
            cascade: [],
            description: undefined,
            persistence: true,
            excludeFromChangeSets: false,
            ...metadata
        };
        return applyData(fullMetadata as PropertyMetadata, metadata);
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
function applyData(data: PropertyMetadata, inputData: PropertyMetadataInput | undefined): PropertyDecorator {
    return (target, key) => {
        if (inputData?.required != undefined && (inputData as WithDefaultMetadata<string>).default != undefined) {
            // eslint-disable-next-line stylistic/max-len
            warn(`setting "required" on ${target.constructor.name}.${key.toString()} won't have any effect, because "default" is also set.`);
        }
        const ctor: Newable<unknown> = target.constructor as Newable<unknown>;
        // eslint-disable-next-line unicorn/error-message
        const stack: string = new Error().stack ?? '';
        MetadataUtilities.setFilePath(ctor, stack);
        const propertyMetadata: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(ctor);
        propertyMetadata[key as string] = data;
        MetadataUtilities.setModelProperties(ctor, propertyMetadata);
    };
}

/**
 * Creates full metadata for an array property item.
 * @param data - The array item input data.
 * @param fullPropertyKey - The full key of the property.
 * @returns The full metadata.
 */
export function createArrayItemPropertyMetadata(
    data: ArrayPropertyItemMetadataInput,
    fullPropertyKey: string
): ArrayPropertyItemMetadata {
    switch (data.type) {
        case 'number': {
            return {
                required: true,
                primary: false,
                unique: false,
                description: undefined,
                min: undefined,
                max: undefined,
                default: undefined,
                excludeFromChangeSets: false,
                enum: undefined,
                ...data
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
                regex: undefined,
                enum: undefined,
                default: undefined,
                excludeFromChangeSets: false,
                ...data
            };
        }
        case 'unknown': {
            return {
                required: true,
                description: undefined,
                excludeFromChangeSets: false,
                ...data
            };
        }
        case 'object': {
            return {
                required: true,
                description: undefined,
                excludeFromChangeSets: false,
                allowAdditionalProperties: false,
                ...data
            };
        }
        case 'boolean': {
            return {
                required: true,
                description: undefined,
                default: undefined,
                excludeFromChangeSets: false,
                ...data
            };
        }
        case 'date': {
            return {
                required: true,
                description: undefined,
                after: undefined,
                before: undefined,
                default: undefined,
                excludeFromChangeSets: false,
                ...data
            };
        }
        case 'array': {
            const metadata: ArrayPropertyMetadata = {
                required: true,
                description: undefined,
                excludeFromChangeSets: false,
                totalMaxSize: '50mb',
                ...data,
                items: createArrayItemPropertyMetadata(data.items, fullPropertyKey)
            };
            return metadata;
        }
        case 'file': {
            if (data.allowedMimeTypes == undefined) {
                warn([
                    `Did not specify allowedMimeTypes on property "${fullPropertyKey}"`,
                    'Defaults to allowing any file type.'
                ].join('\n'));
            }
            return {
                required: true,
                description: undefined,
                allowedMimeTypes: 'all',
                maxSize: '5mb',
                excludeFromChangeSets: false,
                ...data
            };
        }
    }
}