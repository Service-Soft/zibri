import { EventSubscriberRun } from './event-subscriber-run.model';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitClass } from '../entity/omit-class.model';

/**
 * The status a event can have.
 */
export enum EventStatus {
    CREATED = 'CREATED',
    FINISHED = 'FINISHED'
}

/**
 * Definition for an event.
 */
@Entity({ allowOrphan: true })
export class Event<T> extends BaseEntity {
    /**
     * The timestamp at which the event has been created.
     */
    @Property.date({ default: () => new Date() })
    createdAt!: Date;
    /**
     * The timestamp after which the event can be cleaned up.
     */
    @Property.date()
    cleanupAt!: Date;
    /**
     * The type of the event.
     */
    @Property.string()
    type!: string;
    /**
     * The data of the event.
     */
    @Property.unknown()
    data!: T;
    /**
     * The status of the event.
     */
    @Property.string({ enum: EventStatus, default: EventStatus.CREATED })
    status!: EventStatus;
    /**
     * All ids of eg. Classes that are subscribed to this event.
     */
    @Property.array({ items: { type: 'string' } })
    subscriberIds!: string[];
    /**
     * All runs of subscribers that have already happened.
     */
    @Property.oneToMany({ target: () => EventSubscriberRun, inverseSide: 'event' })
    eventSubscriberRuns!: EventSubscriberRun<T>[];
}

/**
 * The data needed to create a new event.
 */
export class EventCreateData<T> extends OmitClass(Event<unknown>, ['id', 'data', 'createdAt', 'eventSubscriberRuns', 'status']) {
    /**
     * The data of the event.
     */
    @Property.unknown()
    data!: T;
}