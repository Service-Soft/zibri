import { findEncryptedValues, StoredEncryptedValue } from './find-encrypted-values.function.ts';
import { EncryptionServiceInterface } from '../../auth/encryption/encryption-service.interface.ts';
import { Newable } from '../../types/newable.type.ts';

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
    const values: StoredEncryptedValue[] = await findEncryptedValues(data, entityClass);
    for (const { value, bindToRow } of values) {
        if (await encryptionService.needsReEncryption(value, bindToRow)) {
            return true;
        }
    }
    return false;
}