import { HashDescriptor, HashSettings } from './hash-descriptor';
import { ModelRegistry } from './model.registry';
import { StringValueUtilities } from './string-value.utilities';
import { HashOptions, HashServiceInterface } from '../../auth/hash/hash-service.interface';
import { AlsUtilities } from '../../context/als.utilities';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { AnyObject } from '../../entity/any-object.model';
import { InternalError } from '../../error-handling/internal-error.model';
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
    await hashHashPropertiesRecursive(context, data, descriptor, hashService, new Set());
}

// eslint-disable-next-line jsdoc/require-jsdoc
async function hashHashPropertiesRecursive<Data, EntityClass>(
    context: HttpRequestContext | WebsocketRequestContext | undefined,
    data: Data,
    descriptor: HashDescriptor<EntityClass>,
    hashService: HashServiceInterface,
    visited: Set<unknown>
): Promise<void> {
    // relations point both ways, so both the descriptors and the data they walk can be cyclic. Two
    // paths reaching the same object also has to hash it once rather than twice
    if (visited.has(data)) {
        return;
    }
    visited.add(data);

    for (const [key, strings] of descriptor.keys) {
        const value: unknown = (data as AnyObject)[key];
        const hashed: unknown = await StringValueUtilities.replaceStrings(value, strings, async (text, hashOptions) => {
            return await hashString(context, data, key, text, hashOptions, hashService);
        });
        if (hashed !== value) {
            (data as AnyObject)[key] = hashed;
        }
    }

    for (const nested of descriptor.nestedValues(data)) {
        await hashHashPropertiesRecursive(context, nested.data, nested.descriptor, hashService, visited);
    }
}

/**
 * Hashes one string of a property.
 * @param context - The current request context, if any.
 * @param data - The object holding the property, which the settings may depend on.
 * @param key - The property, for the message.
 * @param text - The string.
 * @param hashOptions - Its declared hash settings.
 * @param hashService - The service responsible for hashing.
 * @returns The hash.
 * @throws When the string is already a hash.
 */
async function hashString<Data>(
    context: HttpRequestContext | WebsocketRequestContext | undefined,
    data: Data,
    key: string,
    text: string,
    hashOptions: HashSettings,
    hashService: HashServiceInterface
): Promise<string> {
    if (hashService.isHash(text)) {
        // hashing a hash cannot be undone, and the value it replaces is the only thing that could
        // ever have verified a password again. Refused rather than skipped: skipping would make a
        // write that meant to change the password silently not change it.
        throw new InternalError([
            `The property "${key}" was given a value that is already hashed.`,
            'This is what a read-modify-write does - loading an entity and saving it back sends',
            'the stored hash through hashing a second time, which locks the account out for good.',
            'Leave the property off the update, or set it to the new plaintext.'
        ]);
    }
    const options: true | HashOptions<AnyObject> = typeof hashOptions === 'function'
        ? await hashOptions(data, context)
        : hashOptions;
    return await hashService.hash(text, options === true ? undefined : options);
}