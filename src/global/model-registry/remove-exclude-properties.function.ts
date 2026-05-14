import { ExcludeDescriptor } from './exclude-descriptor';
import { ModelRegistry } from './model.registry';
import { AlsUtilities } from '../../context/als.utilities';
import { AnyObject } from '../../entity/any-object.model';
import { Newable } from '../../types/newable.type';
import { MetadataInjectionKeys } from '../../utilities/metadata-injection-keys.enum';

/**
 * Replaces all properties defined with "exclude: true" (or a function returning true)
 * with non-enumerable getters, based on a pre-built ExcludeDescriptor.
 * @param data - The entity instance to process.
 * @param entityClass - The entity class to get the exclude properties from.
 */
export async function removeExcludeProperties<Data, EntityClass>(
    data: Data,
    entityClass: Newable<EntityClass>
): Promise<void> {
    if (data == undefined || typeof data !== 'object') {
        return;
    }

    const descriptor: ExcludeDescriptor<EntityClass> = ModelRegistry.get(entityClass).excludeDescriptor;
    await removeExcludePropertiesRecursive(data, descriptor);
}

// eslint-disable-next-line jsdoc/require-jsdoc
async function removeExcludePropertiesRecursive<Data, EntityClass>(
    data: Data,
    descriptor: ExcludeDescriptor<EntityClass>
): Promise<void> {
    for (const [key, excludeValue] of descriptor.keys) {
        const shouldExclude: boolean = typeof excludeValue === 'function'
            ? await excludeValue(data, AlsUtilities.getCurrentRequestContext())
            : excludeValue;
        if (shouldExclude) {
            hideProperty(data as AnyObject, key);
        }
    }

    for (const [key, nested] of descriptor.nestedKeys) {
        const value: unknown = (data as AnyObject)[key];
        if (value == undefined) {
            continue;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                await removeExcludePropertiesRecursive(item, nested);
            }
        }
        else {
            await removeExcludePropertiesRecursive(value, nested);
        }
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
function hideProperty(data: AnyObject, key: string): void {
    const currentDescriptor: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(data, key);
    if (currentDescriptor && currentDescriptor.enumerable !== true) {
        return;
    }
    const value: unknown = data[key];
    // eslint-disable-next-line typescript/no-dynamic-delete
    delete data[key];
    Object.defineProperty(data, key, {
        enumerable: false,
        configurable: true,
        get(): unknown {
            return Reflect.getMetadata(MetadataInjectionKeys.EXCLUDED_PROPERTY_VALUE, data, key);
        },
        set(v: unknown) {
            Reflect.defineMetadata(MetadataInjectionKeys.EXCLUDED_PROPERTY_VALUE, v, data, key);
        }
    });
    data[key] = value;
}