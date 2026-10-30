import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitStrict } from '../types/omit-strict.type';

// One table for every grant in the framework rather than one per subsystem. A named lock over schema
// setup, a claim on a scheduled execution, a claim on a queued mail and a claim on an event are the
// same object with different keys - see evaluation/10-leases-and-claims.md, which found the same
// three operations hand rolled in three places before this existed.
/**
 * A grant over one named thing, held by one instance at a time: a named lock, or a claim on a
 * scheduled execution, a queued mail or an event.
 *
 * The row is the grant. Its key is unique, so the insert itself decides who gets it - exactly one
 * instance succeeds and the rest are told the answer immediately.
 *
 * Has to be registered in exactly one data source. Registering it twice would mean two instances
 * could hold the same key in different stores and neither would see the other.
 */
// not backed up: a grant belongs to the instances running now. One brought back by a restore would
// hold work for an instance that may not exist, and a restore replacing the table would drop the
// grants held while it runs, its own among them
// acquiring clears only the lapsed grant of the key it asks for, which keeps a contended acquisition
// from scanning the table, and a retained grant is never handed back: a job on a one minute schedule
// would leave a row a minute behind. Only lapsed rows expire, since a grant that has not is held or
// belongs to a tick not decided yet
@Entity({ tenant: 'shared', allowOrphan: true, backedUp: false, expiresBy: 'expiresAt' })
export class Lease extends BaseEntity {
    /**
     * Names the one thing being held.
     *
     * Scoped by whoever takes it, eg. `schema:migrations`, `cron:<job>:<scheduled time>` or
     * `email:send:<id>`. Unique, so the key space is shared by every subsystem and two of them
     * choosing the same string would exclude each other - which is why the prefixes are not
     * optional.
     */
    @Property.string({ unique: true })
    key!: string;

    /**
     * When the grant lapses if it is not renewed.
     *
     * An instance that dies mid work never hands its grant back, so a grant that has run out is
     * taken over by whoever notices first. This is what makes a crashed replica recoverable, and
     * also what makes renewal mandatory: work that outlives this without extending it loses the
     * exclusion it thinks it has.
     */
    @Property.date()
    expiresAt!: Date;

    /**
     * The application and the instance holding it, as `name@instanceId`. Diagnostic only - nothing
     * branches on it.
     */
    @Property.string()
    heldBy!: string;
}

/**
 * The data for taking a grant.
 */
export type CreateLeaseData = OmitStrict<Lease, 'id'>;