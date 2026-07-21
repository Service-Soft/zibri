import { BaseEntity } from '../../entity/base-entity.model';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';

/**
 * A hook that runs before an entity is saved.
 */
export type BeforeSaveHook<
    T extends BaseEntity,
    CreateData extends DeepPartial<T> = DeepPartial<T>,
    UpdateData extends DeepPartial<T> = DeepPartial<T>
> = (
    data: T | CreateData | UpdateData,
    setDefault: boolean,
    entity: Newable<T>
) => void | Promise<void>;