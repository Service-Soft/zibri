import { DefaultDescriptor } from './default-descriptor';
import { ModelRegistry } from './model.registry';
import { AlsUtilities } from '../../context/als.utilities';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { AnyObject } from '../../entity/any-object.model';
import { Newable } from '../../types/newable.type';

/**
 * Sets the default value resolved from the given entityClass on the given data.
 * @param data - The data to set the default values on.
 * @param entityClass - The entity class to get the default properties from.
 */
export async function setDefaultValues<Data, EntityClass>(
    data: Data,
    entityClass: Newable<EntityClass>
): Promise<void> {
    const context: HttpRequestContext | WebsocketRequestContext | undefined = AlsUtilities.getCurrentRequestContext();
    const descriptor: DefaultDescriptor = ModelRegistry.get(entityClass).defaultDescriptor;
    await setDefaultValuesRecursive(context, data, descriptor, new Set());
}

// eslint-disable-next-line jsdoc/require-jsdoc
async function setDefaultValuesRecursive<Data>(
    context: HttpRequestContext | WebsocketRequestContext | undefined,
    data: Data,
    descriptor: DefaultDescriptor,
    visited: Set<unknown>
): Promise<void> {
    if (data == undefined || typeof data !== 'object') {
        return;
    }
    // relations point both ways, so both the descriptors and the data they walk can be cyclic
    if (visited.has(data)) {
        return;
    }
    visited.add(data);

    for (const [key, defaultValue] of descriptor.keys) {
        if ((data as AnyObject)[key] !== undefined) {
            continue;
        }
        (data as AnyObject)[key] = typeof defaultValue === 'function'
            ? await defaultValue(data, context)
            : defaultValue;
    }

    for (const nested of descriptor.nestedValues(data)) {
        await setDefaultValuesRecursive(context, nested.data, nested.descriptor, visited);
    }
}