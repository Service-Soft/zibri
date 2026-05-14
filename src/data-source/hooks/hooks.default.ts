/* eslint-disable jsdoc/require-returns */
import { BeforeReturnHook } from './before-return';
import { BeforeSaveHook } from './before-save';
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
    const res: BeforeReturnHook<T> = async (data, cls) => {
        await decryptEncryptionProperties(data, cls, inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE));
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
    const res: BeforeSaveHook<T, CreateData, UpdateData> = async (data, setDefault, cls) => {
        restoreExcludeProperties(data, cls);
        if (setDefault) {
            await setDefaultValues(data, cls);
        }
        await encryptEncryptionProperties(data, cls, inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE));
        await hashHashProperties(data, cls, inject(ZIBRI_DI_TOKENS.HASH_SERVICE));
    };
    return res;
}