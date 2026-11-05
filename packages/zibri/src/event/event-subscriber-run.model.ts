import { Event } from './event.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { QueuedWorkEntity } from '../queue/queued-work-entity.model';
import { OmitStrict } from '../types/omit-strict.type';

// Three states rather than a `finishedAt` timestamp, because a run that is over and a run that
// succeeded are not the same thing and every reader of this row needs to tell them apart. A single
// timestamp could only say that something happened, which is what let a subscriber that threw count
// as one that was done.
/**
 * How one subscriber's handling of one event ended, or has not ended yet.
 */
export enum EventSubscriberRunStatus {
    // a state rather than a deletion: something has to remember that this is a retry and how many
    // have already been spent
    /**
     * The last attempt failed and another one is owed.
     *
     * `nextAttemptAt` says when. Until then the subscriber is passed over.
     */
    PENDING_RETRY = 'PENDING_RETRY',
    /**
     * The hook completed. Terminal, and the only ending that lets the event finish.
     */
    SUCCEEDED = 'SUCCEEDED',
    /**
     * Every attempt was spent and the last one failed. Terminal.
     *
     * The row is what is left of the work, so it is kept: the event it belongs to is marked failed,
     * and the cleanup job passes over both.
     */
    FAILED = 'FAILED'
}

/**
 * The ledger of one subscriber's attempts at one event.
 *
 * One row per pair, written the first time the hook runs and updated on every attempt after that:
 * `attempts` counts the runs of the hook, successful one included, `error` holds what the last one
 * failed with, and `nextAttemptAt` when the next one is due while the status is `PENDING_RETRY`.
 */
// a hook that threw was once indistinguishable from one that returned, the row's existence being the
// whole answer, and the event it belonged to was declared finished on the strength of it
@Entity({ allowOrphan: true, uniques: [['eventId', 'subscriberId']] })
export class EventSubscriberRun<T> extends QueuedWorkEntity {
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
     * When the last attempt ended, successfully or not.
     *
     * Set on every attempt, so it also says how long a run that is still being retried has been
     * going.
     */
    // kept as data rather than inferred from `createdAt`, which is when the *first* attempt started
    // and stops being useful the moment there is a second
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