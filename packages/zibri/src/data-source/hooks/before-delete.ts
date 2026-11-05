import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';

/**
 * A hook that runs on every row before it is removed. `row` is the row as read, decrypted.
 */
export type BeforeDeleteHook<T extends BaseEntity> = (
    row: T,
    entity: Newable<T>
) => void | Promise<void>;