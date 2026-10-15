import { resolveEncryptOptions, ResolvedEncryptOptions } from './encrypt-encryption-properties.function';
import { EncryptionDescriptor } from './encryption-descriptor';
import { ModelRegistry } from './model.registry';
import { StringValueUtilities } from './string-value.utilities';
import { EncryptionString } from '../../auth/encryption/encryption.utilities';
import { BaseEncryptOptions } from '../../auth/encryption/strategies/encryption-strategy.interface';
import { AlsUtilities } from '../../context/als.utilities';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { AnyObject } from '../../entity/any-object.model';
import { Newable } from '../../types/newable.type';

/**
 * An encrypted value as a row stores it.
 */
export type StoredEncryptedValue = {
    /**
     * The value, as stored.
     */
    value: EncryptionString,
    /**
     * Whether the property it belongs to binds its values to their row.
     */
    bindToRow: boolean
};

/**
 * Finds every encrypted value on the given row, its relations included.
 *
 * Expects a row read with `autoDecrypt: false`, because what a caller asks about is the envelope rather
 * than the value: which strategy and key wrote it, and whether it is bound to its row. None of that
 * survives decryption.
 * @param data - The row, as stored.
 * @param entityClass - The entity it belongs to.
 * @returns The encrypted values, as stored.
 */
export async function findEncryptedValues<Data, EntityClass>(
    data: Data,
    entityClass: Newable<EntityClass>
): Promise<StoredEncryptedValue[]> {
    if (data == undefined || typeof data !== 'object') {
        return [];
    }
    const context: HttpRequestContext | WebsocketRequestContext | undefined = AlsUtilities.getCurrentRequestContext();
    const descriptor: EncryptionDescriptor<EntityClass> = ModelRegistry.get(entityClass).encryptionDescriptor;
    const found: StoredEncryptedValue[] = [];
    await findEncryptedValuesRecursive(context, data, descriptor, found, new Set());
    return found;
}

// eslint-disable-next-line jsdoc/require-jsdoc
async function findEncryptedValuesRecursive<Data, EntityClass>(
    context: HttpRequestContext | WebsocketRequestContext | undefined,
    data: Data,
    descriptor: EncryptionDescriptor<EntityClass>,
    found: StoredEncryptedValue[],
    visited: Set<unknown>
): Promise<void> {
    // relations point both ways, so both the descriptors and the data they walk can be cyclic
    if (visited.has(data)) {
        return;
    }
    visited.add(data);

    for (const [key, strings] of descriptor.keys) {
        for (const described of StringValueUtilities.findStrings((data as AnyObject)[key], strings)) {
            const resolved: ResolvedEncryptOptions<unknown, BaseEncryptOptions<unknown>>
                = await resolveEncryptOptions(context, data, described.settings);
            if (!resolved.encrypt) {
                continue;
            }
            found.push({ value: described.value as EncryptionString, bindToRow: resolved.bindToRow });
        }
    }

    for (const nested of descriptor.nestedValues(data)) {
        await findEncryptedValuesRecursive(context, nested.data, nested.descriptor, found, visited);
    }
}