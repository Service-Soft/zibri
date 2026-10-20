import { AtomicUpdate } from './atomic-update.model.ts';
import { Where } from './where/where-filter.model.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { DeepPartial } from '../../types/deep-partial.type.ts';

/**
 * One row of an upsert: what to insert, and what to change when its identity is already held.
 */
export type UpsertRow<T extends BaseEntity, CreateData extends DeepPartial<T> = DeepPartial<T>> = {
    /**
     * The full row to insert when nothing holds its identity yet. The identity is read off it.
     */
    create: CreateData,
    /**
     * The changes to apply to the row that already holds the identity.
     */
    onConflict: AtomicUpdate<T>,
    /**
     * What the row already holding the identity has to match for the changes to apply, eg. The value
     * a property declaring `optimisticLocking` had when it was read. When it does not match, nothing
     * is written and the call fails with a `ConflictError`.
     */
    where?: Where<T>
};