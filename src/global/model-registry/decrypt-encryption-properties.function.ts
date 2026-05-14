import { EncryptionDescriptor } from './encryption-descriptor';
import { ModelRegistry } from './model.registry';
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
    await decryptEncryptionPropertiesRecursive(context, data, descriptor, encryptionService);
}

// eslint-disable-next-line jsdoc/require-jsdoc, sonar/cognitive-complexity
async function decryptEncryptionPropertiesRecursive<Data, EntityClass>(
    context: HttpRequestContext | WebsocketRequestContext | undefined,
    data: Data,
    descriptor: EncryptionDescriptor<EntityClass>,
    encryptionService: EncryptionServiceInterface
): Promise<void> {
    if (data == undefined || typeof data !== 'object') {
        return;
    }

    for (const [key, encryptionOptions] of descriptor.keys) {
        if (typeof (data as AnyObject)[key] !== 'string') {
            continue;
        }

        const options: boolean | AnyObject = await resolveDecryptOptions(context, data, encryptionOptions);
        if (options === false) {
            continue;
        }

        const decrypted: string = await encryptionService.decrypt(
            (data as AnyObject)[key] as EncryptionString,
            options === true ? undefined : options
        );
        (data as AnyObject)[key] = decrypted;
    }

    for (const [key, nested] of descriptor.nestedKeys) {
        const value: unknown = (data as AnyObject)[key];
        if (value == undefined) {
            continue;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                await decryptEncryptionPropertiesRecursive(context, item, nested, encryptionService);
            }
        }
        else {
            await decryptEncryptionPropertiesRecursive(context, value, nested, encryptionService);
        }
    }
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
    encryptionOptions: ExcludeStrict<EncryptionPropertyValue<Data, TKey, TEncryptOptions, TDecryptOptions>, false>
): Promise<OmitStrict<TDecryptOptions, 'keyId' | 'key'> | boolean> {
    const options: true | EncryptAndDecryptOptions<Data, TKey, TEncryptOptions, TDecryptOptions> = typeof encryptionOptions === 'function'
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