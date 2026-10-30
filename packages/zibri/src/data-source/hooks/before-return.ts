import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';

/**
 * A hook that runs before an entity is returned.
 *
 * `autoDecrypt` is what the caller asked for on a read, and false only when they said so. A caller
 * that wants the stored envelope gets it by turning this off, so anything looking at how a value is
 * stored has to run before this hook.
 */
export type BeforeReturnHook<T extends BaseEntity> = (
    res: T,
    entity: Newable<T>,
    autoDecrypt: boolean
) => void | Promise<void>;