import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';

/**
 * The persisted state of a single rate limit.
 *
 * The rate limit key is a property of its own rather than the row's id. An id is a uuid the framework
 * generates, and every read is narrowed by what a property says it can hold - so a key like `user:42`
 * stored as an id would be written and then never found again.
 *
 * What a state actually holds depends on the algorithm - a token bucket keeps its tokens, a sliding
 * window its timestamps - so the state itself is stored as is. Only the two timestamps cleanup needs
 * to filter on are mirrored into properties of their own.
 */
// the namespace and the key together are unique, because they name at most one row: that is both what
// makes it safe to look a limit up by them and what lets a store resolve one directly instead of reading
// every limit there is
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, uniques: [['namespace', 'key']] })
export class RateLimitStateEntity extends BaseEntity {
    /**
     * The namespace of the store the state belongs to, which keeps the limiters sharing this table apart.
     */
    @Property.string()
    namespace!: string;

    /**
     * The rate limit key, eg. `user:42`.
     */
    @Property.string()
    key!: string;

    /**
     * When this state expires, as a unix timestamp in milliseconds.
     */
    @Property.number()
    expiresAtMs!: number;

    /**
     * When the earliest still open reservation on this state expires, as a unix timestamp in
     * milliseconds, or undefined while there are none.
     *
     * Mirrored out of the state for the same reason the expiry is: it lets cleanup ask for the few
     * limits that are holding capacity nobody is going to use, instead of reading every limit there
     * is and deciding per row.
     */
    @Property.number({ required: false })
    nextReservationExpiryMs?: number;

    /**
     * Counts up once per write, so that a write can require the row to be the one that was read.
     *
     * Reading the state, running the updater and writing the result are three operations, and the
     * lock around them expires on a wall clock. If it does so while the section is still running -
     * a long query, a stalled event loop - a second instance takes it and both write. Requiring the
     * version means the second write is refused rather than silently overwriting the first.
     */
    @Property.number({ format: 'integer' })
    version!: number;

    /**
     * The algorithm specific state.
     */
    @Property.unknown()
    state!: unknown;
}