import { BaseEntity } from '../../entity/base-entity.model.ts';

/**
 * The change applied to a single property when an atomic upsert lands on a row that already exists.
 *
 * `increment` is only offered for numeric properties, because it is the case that cannot be
 * expressed as a value: the amount depends on what is stored right now, which the caller does not
 * know and must not read first.
 */
export type AtomicUpdateValue<TValue> = TValue extends number
    ? { /** Adds the given amount to the stored value. */ increment: number }
    | { /** Overwrites the stored value. */ set: TValue }
    : { /** Overwrites the stored value. */ set: TValue };

/**
 * How an atomic upsert changes a row that already exists.
 *
 * Properties that are not named keep the value they have. An empty update is not useful and is
 * rejected, since it would make the whole call a no-op on the conflict path.
 */
export type AtomicUpdate<T extends BaseEntity> = {
    [K in keyof T]?: AtomicUpdateValue<T[K]>
};