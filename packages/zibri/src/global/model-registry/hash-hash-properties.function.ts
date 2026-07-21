import { HashDescriptor } from './hash-descriptor';
import { ModelRegistry } from './model.registry';
import { HashOptions, HashServiceInterface } from '../../auth/hash/hash-service.interface';
import { AlsUtilities } from '../../context/als.utilities';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { AnyObject } from '../../entity/any-object.model';
import { Newable } from '../../types/newable.type';

/**
 * Hashes all properties defined with the hash flag based on a pre-built HashDescriptor.
 * @param data - The entity instance to process.
 * @param entityClass - The entity class to get the hash properties from.
 * @param hashService - The service responsible for hashing.
 */
export async function hashHashProperties<Data, EntityClass>(
    data: Data,
    entityClass: Newable<EntityClass>,
    hashService: HashServiceInterface
): Promise<void> {
    if (data == undefined || typeof data !== 'object') {
        return;
    }

    const context: HttpRequestContext | WebsocketRequestContext | undefined = AlsUtilities.getCurrentRequestContext();
    const descriptor: HashDescriptor<EntityClass> = ModelRegistry.get(entityClass).hashDescriptor;
    await hashHashPropertiesRecursive(context, data, descriptor, hashService);
}

// eslint-disable-next-line jsdoc/require-jsdoc, sonar/cognitive-complexity
async function hashHashPropertiesRecursive<Data, EntityClass>(
    context: HttpRequestContext | WebsocketRequestContext | undefined,
    data: Data,
    descriptor: HashDescriptor<EntityClass>,
    hashService: HashServiceInterface
): Promise<void> {
    for (const [key, hashOptions] of descriptor.keys) {
        if (typeof (data as AnyObject)[key] !== 'string') {
            continue;
        }
        const options: true | HashOptions<AnyObject> = typeof hashOptions === 'function'
            ? await hashOptions(data, context)
            : hashOptions;

        const hashed: string = await hashService.hash(
            (data as AnyObject)[key] as string,
            options === true ? undefined : options
        );
        (data as AnyObject)[key] = hashed;
    }

    for (const [key, nested] of descriptor.nestedKeys) {
        const value: unknown = (data as AnyObject)[key];
        if (value == undefined) {
            continue;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                await hashHashPropertiesRecursive(context, item, nested, hashService);
            }
        }
        else {
            await hashHashPropertiesRecursive(context, value, nested, hashService);
        }
    }
}