import { AtomicUpdate } from './atomic-update.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { DeepPartial } from '../../types/deep-partial.type';

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
    onConflict: AtomicUpdate<T>
};