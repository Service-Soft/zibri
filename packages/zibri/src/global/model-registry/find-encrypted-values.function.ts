import { resolveEncryptOptions, ResolvedEncryptOptions } from './encrypt-encryption-properties.function.ts';
import { EncryptionDescriptor } from './encryption-descriptor.ts';
import { ModelRegistry } from './model.registry.ts';
import { StringValueUtilities } from './string-value.utilities.ts';
import { EncryptionString } from '../../auth/encryption/encryption.utilities.ts';
import { BaseEncryptOptions } from '../../auth/encryption/strategies/encryption-strategy.interface.ts';
import { AlsUtilities } from '../../context/als.utilities.ts';
import { HttpRequestContext } from '../../context/request/http-request.context.ts';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context.ts';
import { AnyObject } from '../../entity/any-object.model.ts';
import { Newable } from '../../types/newable.type.ts';

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
 * Finds every encrypted value on the given row, leaving out the rows of its relations.
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

// eslint-disable-next-line jsdoc-js/require-jsdoc
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
        // a row read along with this one is a row of its own entity, and found as one
        if (nested.related) {
            continue;
        }
        await findEncryptedValuesRecursive(context, nested.data, nested.descriptor, found, visited);
    }
}