import { SaveOperation } from './before-save';
import { RepositoryHookServices } from './repository-hook-services.model';
import { RepositoryHooks } from './repository-hooks.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { decryptEncryptionProperties } from '../../global/model-registry/decrypt-encryption-properties.function';
import { encryptEncryptionProperties } from '../../global/model-registry/encrypt-encryption-properties.function';
import { hashHashProperties } from '../../global/model-registry/hash-hash-properties.function';
import { removeExcludeProperties } from '../../global/model-registry/remove-exclude-properties.function';
import { restoreExcludeProperties } from '../../global/model-registry/restore-exclude-properties.function';
import { setDefaultValues } from '../../global/model-registry/set-default-values.function';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';

/**
 * Runs the hooks every repository runs: the ones the application provides under
 * `ZIBRI_DI_TOKENS.REPOSITORY_HOOKS`, around what a repository does by default.
 *
 * Given what the hooks run with by the repository, which resolves it once, rather than resolving it
 * per row here.
 */
export abstract class RepositoryHookUtilities {
    /**
     * Runs the before save hooks on a row about to be created or updated.
     * @param data - The row, or the change to it.
     * @param operation - Whether it is created or updated.
     * @param entity - The entity of the row.
     * @param services - What the hooks run with.
     */
    static async beforeSave<T extends BaseEntity>(
        data: T | DeepPartial<T>,
        operation: SaveOperation,
        entity: Newable<T>,
        services: RepositoryHookServices
    ): Promise<void> {
        if (services.hooks.beforeSave == undefined) {
            await this.defaultBeforeSave(data, operation, entity, services);
            return;
        }
        await services.hooks.beforeSave(data, operation, entity, (d, o, e) => this.defaultBeforeSave(d, o, e, services));
    }

    /**
     * Runs the before delete hooks on a row about to be removed.
     * @param row - The row, as read.
     * @param entity - The entity of the row.
     * @param hooks - The hooks the application provides.
     */
    static async beforeDelete<T extends BaseEntity>(row: T, entity: Newable<T>, hooks: RepositoryHooks): Promise<void> {
        if (hooks.beforeDelete == undefined) {
            this.defaultBeforeDelete(row, entity);
            return;
        }
        await hooks.beforeDelete(row, entity, (r, e) => this.defaultBeforeDelete(r, e));
    }

    /**
     * Runs the before return hooks on a row about to be handed back.
     * @param row - The row.
     * @param entity - The entity of the row.
     * @param autoDecrypt - Whether its encrypted properties are decrypted.
     * @param services - What the hooks run with.
     */
    static async beforeReturn<T extends BaseEntity>(
        row: T,
        entity: Newable<T>,
        autoDecrypt: boolean,
        services: RepositoryHookServices
    ): Promise<void> {
        if (services.hooks.beforeReturn == undefined) {
            await this.defaultBeforeReturn(row, entity, autoDecrypt, services);
            return;
        }
        await services.hooks.beforeReturn(row, entity, autoDecrypt, (r, e, a) => this.defaultBeforeReturn(r, e, a, services));
    }

    /**
     * Fills in default values on a created row, then encrypts and hashes.
     * @param data - The row, or the change to it.
     * @param operation - Whether it is created or updated.
     * @param entity - The entity of the row.
     * @param services - What the row is encrypted and hashed with.
     */
    private static async defaultBeforeSave<T extends BaseEntity>(
        data: T | DeepPartial<T>,
        operation: SaveOperation,
        entity: Newable<T>,
        services: RepositoryHookServices
    ): Promise<void> {
        // an excluded property is a non-enumerable getter on a loaded entity, and the driver has to see it
        restoreExcludeProperties(data, entity);
        if (operation === SaveOperation.CREATE) {
            await setDefaultValues(data, entity);
        }
        await encryptEncryptionProperties(data, entity, services.encryptionService);
        await hashHashProperties(data, entity, services.hashService);
    }

    /**
     * Restores the excluded properties of a row about to be removed.
     * @param row - The row, as read.
     * @param entity - The entity of the row.
     */
    private static defaultBeforeDelete<T extends BaseEntity>(row: T, entity: Newable<T>): void {
        // the driver has to see an excluded property to remove the row and hand it back. Nothing
        // else: the row was read, so it arrives decrypted and its password already a hash, and
        // nothing about it is written, since every store deletes by id. Encrypting it again would
        // only give the pass handing it back something to decrypt, and hashing has no read half,
        // so it would replace the only value that could have verified the password
        restoreExcludeProperties(row, entity);
    }

    /**
     * Decrypts a row unless asked not to, and removes its excluded properties.
     * @param row - The row.
     * @param entity - The entity of the row.
     * @param autoDecrypt - Whether its encrypted properties are decrypted.
     * @param services - What the row is decrypted with.
     */
    private static async defaultBeforeReturn<T extends BaseEntity>(
        row: T,
        entity: Newable<T>,
        autoDecrypt: boolean,
        services: RepositoryHookServices
    ): Promise<void> {
        // decrypting first, even though an excluded property is about to be thrown away: an `exclude`
        // callback may read another encrypted property, and it has to see the value rather than the
        // envelope. The cost is a key spent on a value nobody receives
        if (autoDecrypt) {
            await decryptEncryptionProperties(row, entity, services.encryptionService);
        }
        await removeExcludeProperties(row, entity);
    }
}