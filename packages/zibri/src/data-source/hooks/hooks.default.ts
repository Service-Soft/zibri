/* eslint-disable jsdoc/require-returns */
import { BeforeReturnHook } from './before-return';
import { BeforeSaveHook, SaveOperation } from './before-save';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { decryptEncryptionProperties } from '../../global/model-registry/decrypt-encryption-properties.function';
import { encryptEncryptionProperties } from '../../global/model-registry/encrypt-encryption-properties.function';
import { hashHashProperties } from '../../global/model-registry/hash-hash-properties.function';
import { removeExcludeProperties } from '../../global/model-registry/remove-exclude-properties.function';
import { restoreExcludeProperties } from '../../global/model-registry/restore-exclude-properties.function';
import { setDefaultValues } from '../../global/model-registry/set-default-values.function';
import { DeepPartial } from '../../types/deep-partial.type';

/**
 * Gets the default before return hook.
 */
export function getDefaultBeforeReturnHook<T extends BaseEntity>(): BeforeReturnHook<T> {
    const res: BeforeReturnHook<T> = async (data, cls, autoDecrypt) => {
        // decrypting first, even though an excluded property is about to be thrown away: an `exclude`
        // callback may read another encrypted property, and it has to see the value rather than the
        // envelope. The cost is a key spent on a value nobody receives
        if (autoDecrypt) {
            await decryptEncryptionProperties(data, cls, inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE));
        }
        await removeExcludeProperties(data, cls);
    };
    return res;
}

/**
 * Gets the default before save hook.
 */
export function getDefaultBeforeSaveHook<
    T extends BaseEntity,
    CreateData extends DeepPartial<T> = DeepPartial<T>,
    UpdateData extends DeepPartial<T> = DeepPartial<T>
>(): BeforeSaveHook<T, CreateData, UpdateData> {
    const res: BeforeSaveHook<T, CreateData, UpdateData> = async (data, operation, cls) => {
        // on every operation, delete included: an excluded property is a non-enumerable getter on a
        // loaded entity, and the driver has to see it to remove the row and hand it back
        restoreExcludeProperties(data, cls);
        if (operation === SaveOperation.CREATE) {
            await setDefaultValues(data, cls);
        }
        // on a delete too, and that is not redundant: the row was loaded through a find, so
        // beforeReturn already decrypted it, and the delete result goes through beforeReturn once
        // more on the way out. Putting the encryption back is what keeps that second pass balanced.
        await encryptEncryptionProperties(data, cls, inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE));

        if (operation === SaveOperation.DELETE) {
            // hashing is where the symmetry stops. There is no read half to undo it, so what was
            // loaded is *already* a hash - running it again replaces the only value that could ever
            // have verified the password, and cannot be undone. Harmless while the row is being
            // removed, and never right.
            //
            // A **soft** delete does not reach this. SoftDeleteRepository only calls through to the
            // hard delete when `hardDelete: true`; otherwise it writes `{ deleted: true }` through
            // updateById, which arrives here as an UPDATE carrying no encrypted or hashed property
            // at all.
            return;
        }
        await hashHashProperties(data, cls, inject(ZIBRI_DI_TOKENS.HASH_SERVICE));
    };
    return res;
}