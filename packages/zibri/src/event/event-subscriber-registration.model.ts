import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitStrict } from '../types/omit-strict.type';
import { type RunsOn } from '../types/runs-on.type';

/**
 * The event type recorded for a subscriber that listens to every event.
 *
 * A subscriber to all events cannot enumerate the types it will receive, so it registers under this
 * one instead. Namespaced rather than something like `*`, because an application is free to name its
 * events anything and a plausible name must not collide with the marker.
 */
export const ALL_EVENTS_TYPE: string = 'zibri.all-events';

// Without this table each process could only see its own subscribers, so a replica that emitted an
// event marked it finished as soon as *its* subscribers had run - and a subscriber living only on
// other replicas never ran at all, with nothing reporting a failure.
/**
 * Which subscribers exist anywhere in the deployment.
 *
 * Emitting records which subscribers owe the event a run, and finishing reads which of those still
 * exist. Both read this table.
 *
 * One row per subscriber and event type, not per instance: replicas hosting the same subscriber are
 * copies of it.
 *
 * Has to be registered in exactly one data source, for the same reason as the events themselves - two
 * stores would mean two registries and neither would see the other.
 */
// without it an emitter knew only the subscribers of its own process, and marked an event finished
// while subscribers registered on other replicas never ran
@Entity({ tenant: 'shared', allowOrphan: true, uniques: [['subscriberId', 'eventType']] })
export class EventSubscriberRegistration extends BaseEntity {
    /**
     * The id of the subscriber, as it was subscribed under.
     */
    @Property.string()
    subscriberId!: string;

    /**
     * The event type it subscribes to, or `'zibri.all-events'` when it takes every event.
     */
    @Property.string()
    eventType!: string;

    /**
     * `'everyInstance'` for a subscriber every instance hosting it runs, which owes an event no run
     * and is told of one emitted elsewhere as it is emitted. `'oneInstance'` otherwise.
     */
    @Property.string({ enum: { oneInstance: 'oneInstance', everyInstance: 'everyInstance' } })
    runsOn!: RunsOn;

    /**
     * When this registration stops counting if no instance has refreshed it.
     *
     * A subscriber that has been removed from the deployment must eventually stop holding events
     * open, or every event it was recorded against would stay unfinished forever. Any instance still
     * hosting it refreshes the row, so it only lapses once none of them are left.
     *
     * Too short a window and a rolling deploy briefly looks like the subscriber is gone, so events
     * emitted in that gap never reach it. Too long and a genuinely removed subscriber holds events
     * open for that much longer.
     */
    @Property.date()
    expiresAt!: Date;
}

/**
 * The data for registering a subscriber.
 */
export type EventSubscriberRegistrationCreateData = OmitStrict<EventSubscriberRegistration, 'id'>;