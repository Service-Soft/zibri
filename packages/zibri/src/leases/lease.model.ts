import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitStrict } from '../types/omit-strict.type';

/**
 * A grant over one named thing, held by one instance at a time.
 *
 * The row is the grant. Its key is unique, so the insert itself decides who gets it - exactly one
 * instance succeeds and the rest are told the answer immediately. No read-modify-write is involved,
 * which is what makes it correct without depending on anything else being disciplined.
 *
 * One table for every grant in the framework rather than one per subsystem. A named lock over schema
 * setup, a claim on a scheduled execution, a claim on a queued mail and a claim on an event are the
 * same object with different keys - see evaluation/10-leases-and-claims.md, which found the same
 * three operations hand rolled in three places before this existed.
 *
 * Has to be registered in exactly one data source. Registering it twice would mean two instances
 * could hold the same key in different stores and neither would see the other, which is the failure
 * this exists to prevent.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
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
     * The name of the instance holding it. Diagnostic only - nothing branches on it.
     */
    @Property.string()
    heldBy!: string;
}

/**
 * The data for taking a grant.
 */
export type CreateLeaseData = OmitStrict<Lease, 'id'>;