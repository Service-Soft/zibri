import { EncryptionDescriptor } from './encryption-descriptor';
import { ModelRegistry } from './model.registry';
import { StringValueUtilities } from './string-value.utilities';
import { EncryptionServiceInterface } from '../../auth/encryption/encryption-service.interface';
import { EncryptionString } from '../../auth/encryption/encryption.utilities';
import { BaseDecryptOptions, BaseEncryptOptions } from '../../auth/encryption/strategies/encryption-strategy.interface';
import { AlsUtilities } from '../../context/als.utilities';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { AnyObject } from '../../entity/any-object.model';
import { EncryptAndDecryptOptions, EncryptionPropertyValue } from '../../entity/models/string-property-metadata.model';
import { ExcludeStrict } from '../../types/exclude-strict.type';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * Decrypts all properties defined with the encryption flag based on a pre-built EncryptionDescriptor.
 * @param data - The entity instance to process.
 * @param entityClass - The entity class to get the encryption properties from.
 * @param encryptionService - The service responsible for encryption.
 */
export async function decryptEncryptionProperties<Data, EntityClass>(
    data: Data,
    entityClass: Newable<EntityClass>,
    encryptionService: EncryptionServiceInterface
): Promise<void> {
    if (data == undefined || typeof data !== 'object') {
        return;
    }

    const context: HttpRequestContext | WebsocketRequestContext | undefined = AlsUtilities.getCurrentRequestContext();
    const descriptor: EncryptionDescriptor<EntityClass> = ModelRegistry.get(entityClass).encryptionDescriptor;
    // taken from the row rather than from a nested value, so an embedded object's properties are
    // checked against the row that holds them - the same one they were bound to on the way in
    await decryptEncryptionPropertiesRecursive(context, data, descriptor, encryptionService, getRowId(data), new Set());
}

// eslint-disable-next-line jsdoc/require-jsdoc
async function decryptEncryptionPropertiesRecursive<Data, EntityClass>(
    context: HttpRequestContext | WebsocketRequestContext | undefined,
    data: Data,
    descriptor: EncryptionDescriptor<EntityClass>,
    encryptionService: EncryptionServiceInterface,
    rowId: string | undefined,
    visited: Set<unknown>
): Promise<void> {
    if (data == undefined || typeof data !== 'object') {
        return;
    }
    // relations point both ways, so both the descriptors and the data they walk can be cyclic. Two
    // paths reaching the same object also has to decrypt it once rather than twice
    if (visited.has(data)) {
        return;
    }
    visited.add(data);

    for (const [key, strings] of descriptor.keys) {
        const value: unknown = (data as AnyObject)[key];
        const decrypted: unknown = await StringValueUtilities.replaceStrings(value, strings, async (text, encryptionOptions) => {
            const options: boolean | AnyObject = await resolveDecryptOptions(context, data, encryptionOptions);
            if (options === false) {
                return text;
            }
            // the binding goes in whether or not the property asked to be bound: what a value was bound
            // to is written into the value, so this is what it gets checked against rather than what
            // decides it. A value that was moved has nothing here that matches
            return await encryptionService.decrypt(
                text as EncryptionString,
                { ...options === true ? {} : options, binding: { rowId } }
            );
        });
        if (decrypted !== value) {
            (data as AnyObject)[key] = decrypted;
        }
    }

    for (const nested of descriptor.nestedValues(data)) {
        // a row read along with this one was bound to its own id when its own repository wrote it
        const nestedRowId: string | undefined = nested.related ? getRowId(nested.data) : rowId;
        await decryptEncryptionPropertiesRecursive(context, nested.data, nested.descriptor, encryptionService, nestedRowId, visited);
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
function getRowId(data: unknown): string | undefined {
    const id: unknown = (data as AnyObject)['id'];
    return typeof id === 'string' ? id : undefined;
}

// eslint-disable-next-line jsdoc/require-jsdoc
async function resolveDecryptOptions<
    Data,
    TKey,
    TEncryptOptions extends BaseEncryptOptions<TKey>,
    TDecryptOptions extends BaseDecryptOptions<TKey>
>(
    context: HttpRequestContext | WebsocketRequestContext | undefined,
    data: Data,
    encryptionOptions: ExcludeStrict<EncryptionPropertyValue<unknown, TKey, TEncryptOptions, TDecryptOptions>, false>
): Promise<OmitStrict<TDecryptOptions, 'keyId' | 'key'> | boolean> {
    const options: true | EncryptAndDecryptOptions<unknown, TKey, TEncryptOptions, TDecryptOptions>
        = typeof encryptionOptions === 'function'
            ? await encryptionOptions(data, context)
            : encryptionOptions;

    if (options === true) {
        return true;
    }
    if (options.decrypt == undefined) {
        return true;
    }

    return typeof options.decrypt === 'function' ? await options.decrypt(data, context) : options.decrypt;
}