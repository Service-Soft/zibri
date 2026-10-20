import { ExcludeDescriptor } from './exclude-descriptor.ts';
import { ModelRegistry } from './model.registry.ts';
import { AnyObject } from '../../entity/any-object.model.ts';
import { Newable } from '../../types/newable.type.ts';

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
    restoreExcludePropertiesRecursive(data, descriptor, new Set());
}

// eslint-disable-next-line jsdoc-js/require-jsdoc
function restoreExcludePropertiesRecursive<Data, EntityClass>(
    data: Data,
    descriptor: ExcludeDescriptor<EntityClass>,
    visited: Set<unknown>
): void {
    // relations point both ways, so both the descriptors and the data they walk can be cyclic
    if (visited.has(data)) {
        return;
    }
    visited.add(data);

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

    for (const nested of descriptor.nestedValues(data)) {
        restoreExcludePropertiesRecursive(nested.data, nested.descriptor, visited);
    }
}