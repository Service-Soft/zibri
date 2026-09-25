import { resolveEncryptOptions, ResolvedEncryptOptions } from './encrypt-encryption-properties.function';
import { EncryptionDescriptor } from './encryption-descriptor';
import { ModelRegistry } from './model.registry';
import { EncryptionServiceInterface } from '../../auth/encryption/encryption-service.interface';
import { EncryptionString } from '../../auth/encryption/encryption.utilities';
import { AlsUtilities } from '../../context/als.utilities';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { AnyObject } from '../../entity/any-object.model';
import { Newable } from '../../types/newable.type';

/**
 * Whether anything on the given row is not stored the way it should be.
 *
 * Expects a row read with `autoDecrypt: false`, because the question is about the envelope rather
 * than the value: which strategy and key wrote it, and whether it is bound to its row. None of that
 * survives decryption, so a decrypted row cannot answer this at all.
 * @param data - The row, as stored.
 * @param entityClass - The entity it belongs to.
 * @param encryptionService - The service that knows which keys and strategies are retired.
 * @returns Whether the row has at least one value worth writing again.
 */
export async function needsReEncryption<Data, EntityClass>(
    data: Data,
    entityClass: Newable<EntityClass>,
    encryptionService: EncryptionServiceInterface
): Promise<boolean> {
    if (data == undefined || typeof data !== 'object') {
        return false;
    }
    const context: HttpRequestContext | WebsocketRequestContext | undefined = AlsUtilities.getCurrentRequestContext();
    const descriptor: EncryptionDescriptor<EntityClass> = ModelRegistry.get(entityClass).encryptionDescriptor;
    return await needsReEncryptionRecursive(context, data, descriptor, encryptionService, new Set());
}

// eslint-disable-next-line jsdoc/require-jsdoc
async function needsReEncryptionRecursive<Data, EntityClass>(
    context: HttpRequestContext | WebsocketRequestContext | undefined,
    data: Data,
    descriptor: EncryptionDescriptor<EntityClass>,
    encryptionService: EncryptionServiceInterface,
    visited: Set<unknown>
): Promise<boolean> {
    // relations point both ways, so both the descriptors and the data they walk can be cyclic
    if (visited.has(data)) {
        return false;
    }
    visited.add(data);

    if (await anyOwnValueNeedsReEncryption(context, data, descriptor, encryptionService)) {
        return true;
    }

    for (const nested of descriptor.nestedValues(data)) {
        if (await needsReEncryptionRecursive(context, nested.data, nested.descriptor, encryptionService, visited)) {
            return true;
        }
    }

    return false;
}

/**
 * Whether any encrypted property directly on this object is out of date.
 * @param context - The current request context, if any.
 * @param data - The object, holding its values as stored.
 * @param descriptor - The encryption properties of the class it belongs to.
 * @param encryptionService - The service that knows which keys and strategies are retired.
 * @returns Whether at least one of them is worth writing again.
 */
async function anyOwnValueNeedsReEncryption<Data, EntityClass>(
    context: HttpRequestContext | WebsocketRequestContext | undefined,
    data: Data,
    descriptor: EncryptionDescriptor<EntityClass>,
    encryptionService: EncryptionServiceInterface
): Promise<boolean> {
    for (const [key, encryptionOptions] of descriptor.keys) {
        const value: unknown = (data as AnyObject)[key];
        if (typeof value !== 'string') {
            continue;
        }
        // eslint-disable-next-line typescript/no-explicit-any
        const resolved: ResolvedEncryptOptions<any, any> = await resolveEncryptOptions(context, data, encryptionOptions);
        if (!resolved.encrypt) {
            continue;
        }
        if (await encryptionService.needsReEncryption(value as EncryptionString, resolved.bindToRow)) {
            return true;
        }
    }
    return false;
}