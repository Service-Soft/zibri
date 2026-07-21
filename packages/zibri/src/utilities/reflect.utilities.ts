import { MetadataInjectionKeys } from './metadata-injection-keys.enum';

/**
 * Utilities for dealing with reflection.
 */
export abstract class ReflectUtilities {
    /**
     * Set metadata on a target (class or prototype+property).
     * @param key - Unique metadata key (symbol or string).
     * @param value - Value to store.
     * @param target - Class constructor.
     * @param propertyKey - Optional property name.
     */
    static setMetadata<T>(
        key: MetadataInjectionKeys,
        value: T,
        target: Object,
        propertyKey?: string
    ): void {
        if (propertyKey != undefined) {
            // eslint-disable-next-line typescript/no-unsafe-argument
            Reflect.defineMetadata(key, value, (target as Function).prototype, propertyKey);
        }
        else {
            Reflect.defineMetadata(key, value, target);
        }
    }

    /**
     * Read metadata from a target (class or prototype+property).
     * @param key - Metadata key.
     * @param target - Class constructor.
     * @param propertyKey - Optional property name.
     * @returns The stored value or undefined.
     */
    static getMetadata<T>(
        key: MetadataInjectionKeys,
        target: Object,
        propertyKey?: string
    ): T | undefined {
        return propertyKey != undefined
            // eslint-disable-next-line typescript/no-unsafe-argument
            ? Reflect.getMetadata(key, (target as Function).prototype, propertyKey) as T
            : Reflect.getMetadata(key, target) as T;
    }

    /**
     * Read the own metadata from a target (class or prototype+property).
     * @param key - Metadata key.
     * @param target - Class constructor.
     * @param propertyKey - Optional property name.
     * @returns The stored value or undefined.
     */
    static getOwnMetadata<T>(key: MetadataInjectionKeys, target: Object, propertyKey?: string): T | undefined {
        return propertyKey != undefined
            // eslint-disable-next-line typescript/no-unsafe-argument
            ? Reflect.getOwnMetadata(key, (target as Function).prototype, propertyKey) as T
            : Reflect.getOwnMetadata(key, target) as T;
    }

    /**
     * Gets all keys for metadata that has been defined on the given target.
     * @param target - Class constructor.
     * @param propertyKey - Optional property name.
     * @returns The found metadata keys.
     */
    static getMetadataKeys(target: Object, propertyKey?: string): string[] {
        // eslint-disable-next-line typescript/no-unsafe-return
        return propertyKey != undefined
            // eslint-disable-next-line typescript/no-unsafe-argument
            ? Reflect.getMetadataKeys((target as Function).prototype, propertyKey)
            : Reflect.getMetadataKeys(target);
    }
}