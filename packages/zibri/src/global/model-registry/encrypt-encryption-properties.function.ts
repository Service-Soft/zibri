import { EncryptionDescriptor } from './encryption-descriptor';
import { ModelRegistry } from './model.registry';
import { EncryptionServiceInterface, EncryptOptions } from '../../auth/encryption/encryption-service.interface';
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
    await encryptEncryptionPropertiesRecursive(context, data, descriptor, encryptionService);
}

// eslint-disable-next-line jsdoc/require-jsdoc, sonar/cognitive-complexity
async function encryptEncryptionPropertiesRecursive<Data, EntityClass>(
    context: HttpRequestContext | WebsocketRequestContext | undefined,
    data: Data,
    descriptor: EncryptionDescriptor<EntityClass>,
    encryptionService: EncryptionServiceInterface
): Promise<void> {
    for (const [key, encryptionOptions] of descriptor.keys) {
        if (typeof (data as AnyObject)[key] !== 'string') {
            continue;
        }

        // eslint-disable-next-line typescript/no-explicit-any
        const options: boolean | EncryptOptions<any, any> = await resolveEncryptOptions(context, data, encryptionOptions);
        if (options === false) {
            continue;
        }

        const encrypted: string = await encryptionService.encrypt(
            (data as AnyObject)[key] as string,
            options === true ? undefined : options
        );
        (data as AnyObject)[key] = encrypted;
    }

    for (const [key, nested] of descriptor.nestedKeys) {
        const value: unknown = (data as AnyObject)[key];
        if (value == undefined) {
            continue;
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                await encryptEncryptionPropertiesRecursive(context, item, nested, encryptionService);
            }
        }
        else {
            await encryptEncryptionPropertiesRecursive(context, value, nested, encryptionService);
        }
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
async function resolveEncryptOptions<
    Data,
    TKey,
    TEncryptOptions extends BaseEncryptOptions<TKey>
>(
    context: HttpRequestContext | WebsocketRequestContext | undefined,
    data: Data,
    encryptionOptions: ExcludeStrict<EncryptionPropertyValue<Data, TKey, TEncryptOptions, BaseDecryptOptions<TKey>>, false>
): Promise<EncryptOptions<TKey, TEncryptOptions> | boolean> {
    const options: true | EncryptAndDecryptOptions<Data, TKey, TEncryptOptions, BaseDecryptOptions<TKey>>
        = typeof encryptionOptions === 'function'
            ? await encryptionOptions(data, context)
            : encryptionOptions;

    if (options === true) {
        return true;
    }
    if (options.encrypt == undefined) {
        return true;
    }

    const strategyOptions: boolean | Partial<OmitStrict<TEncryptOptions, 'key'>> | undefined = typeof options.encrypt === 'function'
        ? await options.encrypt(data, context)
        : options.encrypt;
    if (typeof strategyOptions === 'boolean') {
        return strategyOptions;
    }

    return {
        strategy: options.strategy,
        strategyOptions: strategyOptions
    };
}