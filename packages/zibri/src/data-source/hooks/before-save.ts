import { BaseEntity } from '../../entity/base-entity.model';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';

/**
 * What a `beforeSave` hook is running for.
 */
export enum SaveOperation {
    /**
     * A new row. The only operation that fills in defaults.
     */
    CREATE = 'create',
    /**
     * An existing row being written to. `data` holds only what changes.
     */
    UPDATE = 'update'
}

/**
 * A hook that runs on every row before it is written: default values, encryption and hashing.
 */
export type BeforeSaveHook<T extends BaseEntity> = (
    data: T | DeepPartial<T>,
    operation: SaveOperation,
    entity: Newable<T>
) => void | Promise<void>;