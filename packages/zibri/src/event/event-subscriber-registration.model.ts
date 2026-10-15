import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitStrict } from '../types/omit-strict.type';

/**
 * The event type recorded for a subscriber that listens to every event.
 *
 * A subscriber to all events cannot enumerate the types it will receive, so it registers under this
 * one instead. Namespaced rather than something like `*`, because an application is free to name its
 * events anything and a plausible name must not collide with the marker.
 */
export const ALL_EVENTS_TYPE: string = 'zibri.all-events';

/**
 * Which subscribers exist anywhere in the deployment, rather than in the process asking.
 *
 * Emitting has to record which subscribers owe the event a run, and finishing has to know which of
 * those still exist. Both read this table. Without it each process could only see its own
 * subscribers, so a replica that emitted an event marked it finished as soon as *its* subscribers had
 * run - and a subscriber living only on other replicas never ran at all, with nothing reporting a
 * failure. See evaluation/04-infrastructure-subsystems.md 1.4b.
 *
 * One row per subscriber and event type, not per instance: replicas hosting the same subscriber are
 * copies of it, and it is the subscriber that owes the event a run rather than any one process.
 *
 * Has to be registered in exactly one data source, for the same reason as the events themselves - two
 * stores would mean two registries and neither would see the other.
 */
@Entity({ tenant: 'shared', allowOrphan: true, uniques: [['subscriberId', 'eventType']] })
export class EventSubscriberRegistration extends BaseEntity {
    /**
     * The id of the subscriber, as it was subscribed under.
     */
    @Property.string()
    subscriberId!: string;

    /**
     * The event type it subscribes to, or {@link ALL_EVENTS_TYPE} when it takes every event.
     */
    @Property.string()
    eventType!: string;

    /**
     * When this registration stops counting if no instance has refreshed it.
     *
     * A subscriber that has been removed from the deployment must eventually stop holding events
     * open, or every event it was recorded against would stay unfinished forever. Any instance still
     * hosting it refreshes the row, so it only lapses once none of them are left.
     *
     * The window is a trade rather than a tuning knob: too short and a rolling deploy briefly looks
     * like the subscriber is gone, so events emitted in that gap never reach it. Too long and a
     * genuinely removed subscriber holds events open for that much longer.
     */
    @Property.date()
    expiresAt!: Date;
}

/**
 * The data for registering a subscriber.
 */
export type EventSubscriberRegistrationCreateData = OmitStrict<EventSubscriberRegistration, 'id'>;