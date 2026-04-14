import { ExcludeDescriptor } from './exclude-descriptor';
import { ModelRegistry } from './model.registry';
import { AnyObject } from '../../entity/any-object.model';
import { Newable } from '../../types/newable.type';

/**
 * Restores all excluded properties back to enumerable own properties before persisting.
 * @param data - The data to restore properties on.
 * @param entityClass - The entity class to get the exclude properties from.
 */
export function restoreExcludeProperties<Data, EntityClass>(
    data: Data,
    entityClass: Newable<EntityClass>
): void {
    if (data == undefined || typeof data !== 'object') {
        return;
    }
    const descriptor: ExcludeDescriptor<EntityClass> = ModelRegistry.get(entityClass).excludeDescriptor;
    restoreExcludePropertiesRecursive(data, descriptor);
}

// eslint-disable-next-line jsdoc/require-jsdoc
function restoreExcludePropertiesRecursive<Data, EntityClass>(
    data: Data,
    descriptor: ExcludeDescriptor<EntityClass>
): void {
    for (const [key] of descriptor.keys) {
        const currentDescriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(data, key);
        if (currentDescriptor && currentDescriptor.enumerable !== true && currentDescriptor.get) {
            const value: unknown = (data as AnyObject)[key]; // triggers the getter
            Object.defineProperty(data, key, {
                value,
                enumerable: true,
                writable: true,
                configurable: true
            });
        }
    }

    for (const [key, nested] of descriptor.nestedKeys) {
        const value: unknown = (data as AnyObject)[key];
        if (value == undefined) {
            continue;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                restoreExcludePropertiesRecursive(item, nested);
            }
        }
        else {
            restoreExcludePropertiesRecursive(value, nested);
        }
    }
}