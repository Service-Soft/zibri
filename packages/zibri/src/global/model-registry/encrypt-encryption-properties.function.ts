import { EncryptionDescriptor } from './encryption-descriptor';
import { ModelRegistry } from './model.registry';
import { StringValueUtilities } from './string-value.utilities';
import { EncryptionServiceInterface, EncryptOptions } from '../../auth/encryption/encryption-service.interface';
import { BaseDecryptOptions, BaseEncryptOptions, EncryptionBinding } from '../../auth/encryption/strategies/encryption-strategy.interface';
import { AlsUtilities } from '../../context/als.utilities';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { AnyObject } from '../../entity/any-object.model';
import { EncryptAndDecryptOptions, EncryptionPropertyValue } from '../../entity/models/string-property-metadata.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { ExcludeStrict } from '../../types/exclude-strict.type';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * Encrypts all properties defined with the encryption flag based on a pre-built EncryptionDescriptor.
 * @param data - The entity instance to process.
 * @param entityClass - The entity class to get the encryption properties from.
 * @param encryptionService - The service responsible for encryption.
 */
export async function encryptEncryptionProperties<Data, EntityClass>(
    data: Data,
    entityClass: Newable<EntityClass>,
    encryptionService: EncryptionServiceInterface
): Promise<void> {
    if (data == undefined || typeof data !== 'object') {
        return;
    }

    const context: HttpRequestContext | WebsocketRequestContext | undefined = AlsUtilities.getCurrentRequestContext();
    const descriptor: EncryptionDescriptor<EntityClass> = ModelRegistry.get(entityClass).encryptionDescriptor;
    // read from the row being written, not from a nested value, so an embedded object's properties
    // are bound to the row that holds them
    const rowId: unknown = (data as AnyObject)['id'];
    await encryptEncryptionPropertiesRecursive(
        context,
        data,
        descriptor,
        encryptionService,
        typeof rowId === 'string' ? rowId : undefined,
        new Set()
    );
}

// eslint-disable-next-line jsdoc/require-jsdoc
async function encryptEncryptionPropertiesRecursive<Data, EntityClass>(
    context: HttpRequestContext | WebsocketRequestContext | undefined,
    data: Data,
    descriptor: EncryptionDescriptor<EntityClass>,
    encryptionService: EncryptionServiceInterface,
    rowId: string | undefined,
    visited: Set<unknown>
): Promise<void> {
    // relations point both ways, so both the descriptors and the data they walk can be cyclic. Two
    // paths reaching the same object also has to encrypt it once rather than twice
    if (visited.has(data)) {
        return;
    }
    visited.add(data);

    for (const [key, strings] of descriptor.keys) {
        const value: unknown = (data as AnyObject)[key];
        const encrypted: unknown = await StringValueUtilities.replaceStrings(value, strings, async (text, encryptionOptions) => {
            const resolved: ResolvedEncryptOptions<unknown, BaseEncryptOptions<unknown>>
                = await resolveEncryptOptions(context, data, encryptionOptions);
            if (!resolved.encrypt) {
                return text;
            }

            if (resolved.bindToRow && rowId == undefined) {
                // every write that reaches here goes through a repository, and those assign the id before
                // the hook runs. Getting here means something called the hook directly, and writing an
                // unbound value silently would be a hole in the guarantee exactly where nobody looks
                throw new InternalError(
                    `"${key}" is encrypted and bound to its row, but the data being written has no id.`
                );
            }
            const binding: EncryptionBinding = { rowId: resolved.bindToRow ? rowId : undefined };

            return await encryptionService.encrypt(text, {
                strategy: resolved.options?.strategy,
                strategyOptions: { ...resolved.options?.strategyOptions, binding }
            });
        });
        if (encrypted !== value) {
            (data as AnyObject)[key] = encrypted;
        }
    }

    for (const nested of descriptor.nestedValues(data)) {
        // a row this one references is not written along with it: only the reference is. Its own
        // repository encrypts it, for its own id, and what the caller holds of it stays the value
        if (nested.related) {
            continue;
        }
        await encryptEncryptionPropertiesRecursive(context, nested.data, nested.descriptor, encryptionService, rowId, visited);
    }
}

/**
 * Names the properties of the given data that are encrypted and bound to the row they end up in.
 *
 * A bound value can only be encrypted once the row it lands in is known, so a caller writing to many
 * rows at once has to know whether it is about to do that before it writes anything. Which properties
 * those are is not something the metadata alone can answer: the settings may be a function of the
 * data, and a property may only be encrypted for some values.
 * @param data - The data about to be written.
 * @param entityClass - The entity being written to.
 * @returns The property paths, empty when nothing being written is bound.
 */
export async function boundEncryptionProperties<Data, EntityClass>(
    data: Data,
    entityClass: Newable<EntityClass>
): Promise<string[]> {
    if (data == undefined || typeof data !== 'object') {
        return [];
    }
    const context: HttpRequestContext | WebsocketRequestContext | undefined = AlsUtilities.getCurrentRequestContext();
    const descriptor: EncryptionDescriptor<EntityClass> = ModelRegistry.get(entityClass).encryptionDescriptor;
    return await boundEncryptionPropertiesRecursive(context, data, descriptor, '', new Set());
}

// eslint-disable-next-line jsdoc/require-jsdoc
async function boundEncryptionPropertiesRecursive<Data, EntityClass>(
    context: HttpRequestContext | WebsocketRequestContext | undefined,
    data: Data,
    descriptor: EncryptionDescriptor<EntityClass>,
    prefix: string,
    visited: Set<unknown>
): Promise<string[]> {
    // relations point both ways, so both the descriptors and the data they walk can be cyclic
    if (visited.has(data)) {
        return [];
    }
    visited.add(data);

    const res: string[] = [];

    for (const [key, strings] of descriptor.keys) {
        for (const described of StringValueUtilities.findStrings((data as AnyObject)[key], strings)) {
            const resolved: ResolvedEncryptOptions<unknown, BaseEncryptOptions<unknown>>
                = await resolveEncryptOptions(context, data, described.settings);
            if (resolved.encrypt && resolved.bindToRow) {
                // the property rather than each item: what the caller has to know is that writing this
                // property to many rows cannot be one statement, which one bound string already decides
                res.push(`${prefix}${key}`);
                break;
            }
        }
    }

    for (const nested of descriptor.nestedValues(data)) {
        // nothing of a referenced row is written, so nothing of it is bound either
        if (nested.related) {
            continue;
        }
        res.push(...await boundEncryptionPropertiesRecursive(context, nested.data, nested.descriptor, `${prefix}${nested.path}.`, visited));
    }

    return res;
}

/**
 * What a property's encryption settings come out to for one particular value.
 */
export type ResolvedEncryptOptions<TKey, TEncryptOptions extends BaseEncryptOptions<TKey>> = {
    /**
     * Whether this value is encrypted at all.
     */
    encrypt: boolean,
    /**
     * Whether the encrypted value is bound to the row it is stored in. Defaults to true.
     */
    bindToRow: boolean,
    /**
     * The strategy and its options, when the property named any.
     */
    options: EncryptOptions<TKey, TEncryptOptions> | undefined
};

/**
 * Resolves what a property's encryption settings come out to for one particular value.
 *
 * Exported because the repository has to know the answer before it writes: a bound value cannot be
 * written to many rows at once, and the settings may be a function of the data, so there is no way to
 * tell from the metadata alone. Resolving it in one place is also what keeps a caller's own options
 * function from being asked twice about the same value while encrypting it.
 * @param context - The current request context, if any.
 * @param data - The data being written, which the settings may depend on.
 * @param encryptionOptions - The property's declared encryption settings.
 * @returns What applies to this value.
 */
export async function resolveEncryptOptions<
    Data,
    TKey,
    TEncryptOptions extends BaseEncryptOptions<TKey>
>(
    context: HttpRequestContext | WebsocketRequestContext | undefined,
    data: Data,
    encryptionOptions: ExcludeStrict<EncryptionPropertyValue<unknown, TKey, TEncryptOptions, BaseDecryptOptions<TKey>>, false>
): Promise<ResolvedEncryptOptions<TKey, TEncryptOptions>> {
    const options: true | EncryptAndDecryptOptions<unknown, TKey, TEncryptOptions, BaseDecryptOptions<TKey>>
        = typeof encryptionOptions === 'function'
            ? await encryptionOptions(data, context)
            : encryptionOptions;

    if (options === true) {
        return { encrypt: true, bindToRow: true, options: undefined };
    }

    const bindToRow: boolean = options.bindToRow ?? true;
    if (options.encrypt == undefined) {
        return { encrypt: true, bindToRow, options: { strategy: options.strategy } };
    }

    const strategyOptions: boolean | Partial<OmitStrict<TEncryptOptions, 'key'>> | undefined = typeof options.encrypt === 'function'
        ? await options.encrypt(data, context)
        : options.encrypt;
    if (typeof strategyOptions === 'boolean') {
        return { encrypt: strategyOptions, bindToRow, options: { strategy: options.strategy } };
    }

    return {
        encrypt: true,
        bindToRow,
        options: {
            strategy: options.strategy,
            strategyOptions: strategyOptions
        }
    };
}