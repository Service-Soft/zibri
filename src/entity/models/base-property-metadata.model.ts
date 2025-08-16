
/**
 * Metadata shared by all properties.
 */
export type BasePropertyMetadata = {
    /**
     * Whether or not the property is required.
     */
    required: boolean,
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
    default: T | (<X extends Object>(createData: X) => T | Promise<T>) | undefined
};