import { EventSubscriberRun } from './event-subscriber-run.model';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitClass } from '../entity/omit-class.model';

/**
 * The status a event can have.
 */
export enum EventStatus {
    /**
     * At least one subscriber that was registered at emit time still owes it a run.
     *
     * Either it has never run, or its last attempt failed and another one is due. This is the only
     * status the dispatch poll hands back out.
     */
    CREATED = 'CREATED',
    /**
     * Every subscriber that was registered at emit time handled it successfully.
     *
     * The only status the cleanup job deletes, because it is the only one where the row has nothing
     * left to say.
     */
    FINISHED = 'FINISHED',
    /**
     * Nobody owes it a run any more, and at least one subscriber gave up.
     *
     * Terminal and kept: the event and the runs under it are the record of work that was owed and
     * never done, which is worth more than the space it costs. See the retention note in the event
     * docs.
     */
    FAILED = 'FAILED'
}

/**
 * Definition for an event.
 */
@Entity({ allowOrphan: true, defaultOrder: { createdAt: 'ASC' } })
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