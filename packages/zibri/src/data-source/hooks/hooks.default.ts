/* eslint-disable jsdoc-js/require-returns */
import { BeforeReturnHook } from './before-return.ts';
import { BeforeSaveHook, SaveOperation } from './before-save.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { decryptEncryptionProperties } from '../../global/model-registry/decrypt-encryption-properties.function.ts';
import { encryptEncryptionProperties } from '../../global/model-registry/encrypt-encryption-properties.function.ts';
import { hashHashProperties } from '../../global/model-registry/hash-hash-properties.function.ts';
import { removeExcludeProperties } from '../../global/model-registry/remove-exclude-properties.function.ts';
import { restoreExcludeProperties } from '../../global/model-registry/restore-exclude-properties.function.ts';
import { setDefaultValues } from '../../global/model-registry/set-default-values.function.ts';
import { DeepPartial } from '../../types/deep-partial.type.ts';

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
 * Every hook `getDefaultBeforeSaveHook` handed out. What one does for a delete is known - nothing a
 * row that is not handed back needs - which a hook of an application's own is not.
 */
const defaultBeforeSaveHooks: WeakSet<object> = new WeakSet();

/**
 * Whether the given hook is one `getDefaultBeforeSaveHook` handed out.
 * @param hook - The hook a repository was given.
 * @returns True for the default hook, false for one of your own.
 */
export function isDefaultBeforeSaveHook(hook: object): boolean {
    return defaultBeforeSaveHooks.has(hook);
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
        if (operation === SaveOperation.DELETE) {
            // the row was loaded through a find, so it arrives decrypted and its password already a
            // hash - and nothing about it is written, since every store deletes by id. Encrypting it
            // again only bought the pass handing it back something to decrypt, two key operations per
            // value on a row about to stop existing; that pass now leaves it as it is. Hashing has no
            // read half at all, so running it would replace the only value that could have verified
            // the password.
            //
            // A **soft** delete does not reach this. SoftDeleteRepository only calls through to the
            // hard delete when `hardDelete: true`; otherwise it writes `{ deleted: true }` through
            // updateById, which arrives here as an UPDATE carrying no encrypted or hashed property
            // at all.
            return;
        }
        if (operation === SaveOperation.CREATE) {
            await setDefaultValues(data, cls);
        }
        await encryptEncryptionProperties(data, cls, inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE));
        await hashHashProperties(data, cls, inject(ZIBRI_DI_TOKENS.HASH_SERVICE));
    };
    defaultBeforeSaveHooks.add(res);
    return res;
}