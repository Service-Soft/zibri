import { Event } from './event.model';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { LoggedError } from '../logging/logged-error.model';
import { OmitStrict } from '../types/omit-strict.type';

/**
 * How one subscriber's handling of one event ended, or has not ended yet.
 *
 * Three states rather than a `finishedAt` timestamp, because a run that is over and a run that
 * succeeded are not the same thing and every reader of this row needs to tell them apart. A single
 * timestamp could only say that something happened, which is what let a subscriber that threw count
 * as one that was done.
 */
export enum EventSubscriberRunStatus {
    /**
     * The last attempt failed and another one is owed.
     *
     * `nextRetryAt` says when. Until then the subscriber is passed over, which is the whole reason
     * the failure is a state rather than a deletion: something has to remember that this is a retry
     * and how many have already been spent.
     */
    PENDING_RETRY = 'PENDING_RETRY',
    /**
     * The hook completed. Terminal, and the only ending that lets the event finish.
     */
    SUCCEEDED = 'SUCCEEDED',
    /**
     * Every attempt was spent and the last one failed. Terminal.
     *
     * The row is what is left of the work, so it is kept: the event it belongs to is marked failed
     * rather than finished, and the cleanup job passes over both.
     */
    FAILED = 'FAILED'
}

/**
 * The ledger of one subscriber's attempts at one event.
 *
 * One row per pair, written the first time the hook runs and updated on every attempt after that.
 * It used to be a record that the run had happened at all - created once, its existence the whole
 * answer - which meant a hook that threw was indistinguishable from one that returned, and the
 * event it belonged to was declared finished on the strength of it.
 */
@Entity({ allowOrphan: true, uniques: [['eventId', 'subscriberId']] })
export class EventSubscriberRun<T> extends BaseEntity {
    /**
     * The tenant of the event this run belongs to, or null for an event of no tenant.
     */
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string | null;
    /**
     * The timestamp at which the event run has been created.
     */
    @Property.date({ default: () => new Date() })
    createdAt!: Date;
    /**
     * The event that triggered this run.
     */
    @Property.manyToOne({ target: () => Event, joinColumn: 'eventId', inverseSide: 'eventSubscriberRuns' })
    event!: Event<T>;
    /**
     * The id of the event that this run belongs to.
     */
    @Property.string({ format: 'uuid' })
    eventId!: string;
    /**
     * The id of the subscriber.
     */
    @Property.string()
    subscriberId!: string;
    /**
     * Where this pair stands.
     */
    @Property.string({ enum: EventSubscriberRunStatus })
    status!: EventSubscriberRunStatus;
    /**
     * How many times the hook has been run for this event, successful attempt included.
     *
     * Counted on the row rather than in the process that runs it, because the attempts are spread
     * across polls and restarts and no one process sees all of them.
     */
    @Property.number({ format: 'integer' })
    attempts!: number;
    /**
     * What the last attempt failed with, if it did.
     *
     * Cleared by a later attempt that succeeds, so it always describes the ending the status names.
     *
     * A `LoggedError` rather than the `Error` itself, the way `LogContext` stores one. An `Error`'s
     * message and stack are not enumerable, so the column it goes into keeps `{}` of it - which is
     * a row that says a failure happened and nothing about what it was.
     */
    @Property.object({ cls: () => LoggedError, required: false })
    error?: LoggedError | null;
    /**
     * When the next attempt becomes due, while the status is `PENDING_RETRY`.
     *
     * Null on both terminal states: nothing is owed, so there is nothing to be due.
     */
    @Property.date({ required: false })
    nextRetryAt?: Date | null;
    /**
     * When the last attempt ended, successfully or not.
     *
     * Set on every attempt, so it also says how long a run that is still being retried has been
     * going. Kept as data rather than inferred from `createdAt`, which is when the *first* attempt
     * started and stops being useful the moment there is a second.
     */
    @Property.date()
    finishedAt!: Date;
}

/**
 * The data needed to create a new event subscriber run.
 *
 * Names the event by its id rather than by the object. A row is written with `upsert`, which builds
 * its statement out of columns and has no relation to resolve - and `eventId` is a declared property
 * here, so saying it directly costs nothing.
 */
export type EventSubscriberRunCreateData<T> = OmitStrict<EventSubscriberRun<T>, 'id' | 'event' | 'createdAt'>;