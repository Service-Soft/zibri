import { MetadataInjectionKeys } from '../di';

export abstract class ReflectUtilities {

    /**
     * Set metadata on a target (class or prototype+property).
     * @param key - Unique metadata key (symbol or string).
     * @param value - Value to store.
     * @param target - Class constructor or prototype object.
     * @param propertyKey - Optional property name.
     */
    static setMetadata<T>(
        key: MetadataInjectionKeys,
        value: T,
        target: Object,
        propertyKey?: string
    ): void {
        if (propertyKey != undefined) {
            Reflect.defineMetadata(key, value, (target as any).prototype, propertyKey);
        }
        else {
            Reflect.defineMetadata(key, value, target);
        }
    }

    /**
     * Read metadata from a target (class or prototype+property).
     * @param key - Metadata key.
     * @param target - Class constructor or prototype object.
     * @param propertyKey - Optional property name.
     * @returns The stored value or undefined.
     */
    static getMetadata<T>(
        key: MetadataInjectionKeys,
        target: Object,
        propertyKey?: string
    ): T | undefined {
        return propertyKey != undefined
            ? Reflect.getMetadata(key, (target as any).prototype, propertyKey) as T
            : Reflect.getMetadata(key, target) as T;
    }

    static getOwnMetadata<T>(key: MetadataInjectionKeys, target: Object): T {
        return Reflect.getOwnMetadata(key, target) as T;
    }
}