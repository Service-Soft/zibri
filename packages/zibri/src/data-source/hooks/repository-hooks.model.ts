import { BeforeDeleteHook } from './before-delete';
import { BeforeReturnHook } from './before-return';
import { BeforeSaveHook, SaveOperation } from './before-save';
import { BaseEntity } from '../../entity/base-entity.model';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';

/**
 * The hooks every repository runs, provided under `ZIBRI_DI_TOKENS.REPOSITORY_HOOKS`. Each receives
 * the hook it wraps, which does what a repository does by default, and decides when to call it.
 *
 * A repository declared with `@RepositoryFor` wraps these in turn, by overriding its `beforeSave`,
 * `beforeDelete` and `beforeReturn` methods.
 */
export type RepositoryHooks = {
    /**
     * Runs on every row before it is created or updated. The wrapped hook fills in default values,
     * encrypts and hashes.
     */
    beforeSave?: <T extends BaseEntity>(
        data: T | DeepPartial<T>,
        operation: SaveOperation,
        entity: Newable<T>,
        wrapped: BeforeSaveHook<T>
    ) => void | Promise<void>,
    /**
     * Runs on every row before it is removed. Declaring it makes `deleteAll` read every row it
     * removes, to hand each one over.
     */
    beforeDelete?: <T extends BaseEntity>(
        row: T,
        entity: Newable<T>,
        wrapped: BeforeDeleteHook<T>
    ) => void | Promise<void>,
    /**
     * Runs on every row before it is handed back. The wrapped hook decrypts, unless `autoDecrypt` is
     * false, and removes excluded properties.
     */
    beforeReturn?: <T extends BaseEntity>(
        row: T,
        entity: Newable<T>,
        autoDecrypt: boolean,
        wrapped: BeforeReturnHook<T>
    ) => void | Promise<void>
};