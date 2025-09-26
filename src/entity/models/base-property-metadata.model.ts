import { BaseEntity } from '../base-entity.model';

/**
 * Metadata shared by all properties.
 */
// eslint-disable-next-line typescript/no-explicit-any
export type BasePropertyMetadata<T extends BaseEntity = any> = {
    /**
     * Whether or not the property is required.
     */
    required: boolean | ((data: T) => boolean),
    /**
     * A description of the property.
     */
    description: string | undefined,
    /**
     * Whether or not this property should be excluded when generating change sets.
     */
    excludeFromChangeSets: boolean
};

/**
 * Adds a default property which can be used to fill empty properties with default values.
 */
export type WithDefaultMetadata<T extends string | number | boolean | Date> = {
    /**
     * The default value to set an empty property to when defined.
     */
    // eslint-disable-next-line typescript/no-explicit-any
    default: T | ((createData: any) => T | Promise<T>) | undefined
};