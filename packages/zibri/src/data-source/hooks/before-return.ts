import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';

/**
 * A hook that runs before an entity is returned.
 */
export type BeforeReturnHook<T extends BaseEntity> = (res: T, entity: Newable<T>) => void | Promise<void>;