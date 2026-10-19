import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';

/**
 * Value for the exclude setting on a property.
 */
export type ExcludePropertyValue = boolean
    // eslint-disable-next-line typescript/no-explicit-any
    | ((data: any, ctx: HttpRequestContext | WebsocketRequestContext | undefined) => boolean | Promise<boolean>);
/**
 * Value for the required setting on a property.
 */
export type RequiredPropertyValue = boolean
    // eslint-disable-next-line typescript/no-explicit-any
    | ((data: any, ctx: HttpRequestContext | WebsocketRequestContext | undefined) => boolean | Promise<boolean>);

/**
 * Metadata shared by all properties.
 */
export type BasePropertyMetadata = {
    /**
     * Whether or not the property is required.
     */
    required: RequiredPropertyValue,
    /**
     * A description of the property.
     */
    description: string | undefined,
    /**
     * Whether this property should be excluded from external-facing outputs.
     */
    exclude: ExcludePropertyValue,
    /**
     * Whether or not this property should be excluded when generating change sets.
     */
    excludeFromChangeSets: boolean
};

/**
 * Value for the default setting on a property.
 */
export type DefaultPropertyValue<T extends string | number | boolean | Date> = T
    | undefined
    // eslint-disable-next-line typescript/no-explicit-any
    | ((createData: any, ctx: HttpRequestContext | WebsocketRequestContext | undefined) => T | Promise<T>);

/**
 * Adds a default property which can be used to fill empty properties with default values.
 */
export type WithDefaultMetadata<T extends string | number | boolean | Date> = {
    /**
     * The value the property is given when a row is created without one: the row itself, the models
     * it holds, and a related row a write creates. An update writes what it is given and fills
     * nothing in, not even into a nested value it writes. `null` is a value, so it is stored as given.
     */
    default: DefaultPropertyValue<T>
};