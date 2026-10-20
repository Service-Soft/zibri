import { BaseEntity } from '../../entity/base-entity.model.ts';
import { DeepPartial } from '../../types/deep-partial.type.ts';
import { Newable } from '../../types/newable.type.ts';

/**
 * What a `beforeSave` hook is running for.
 *
 * A delete runs the hook too, because an excluded property has to be restored before the driver sees
 * the row - but it is not a write, and a hook that cannot tell the difference will treat a row on its
 * way out as one being persisted.
 */
export enum SaveOperation {
    /**
     * A new row. The only operation that fills in defaults.
     */
    CREATE = 'create',
    /**
     * An existing row being written to.
     */
    UPDATE = 'update',
    /**
     * An existing row being removed. `data` is the loaded entity, not a change to it.
     */
    DELETE = 'delete'
}

/**
 * A hook that runs before an entity is saved.
 *
 * Also runs for a delete - see {@link SaveOperation}, and branch on it rather than assuming the data
 * is about to be written.
 */
export type BeforeSaveHook<
    T extends BaseEntity,
    CreateData extends DeepPartial<T> = DeepPartial<T>,
    UpdateData extends DeepPartial<T> = DeepPartial<T>
> = (
    data: T | CreateData | UpdateData,
    operation: SaveOperation,
    entity: Newable<T>
) => void | Promise<void>;