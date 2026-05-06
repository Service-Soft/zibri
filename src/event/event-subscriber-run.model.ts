import { Event } from './event.model';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitClass } from '../entity/omit-class.model';

/**
 * Data of a event subscriber run.
 */
@Entity({ allowOrphan: true })
export class EventSubscriberRun<T> extends BaseEntity {
    /**
     * The timestamp at which the event run has been created.
     */
    @Property.date({ default: () => new Date() })
    createdAt!: Date;
    /**
     * The event that triggered this run.
     */
    @Property.manyToOne({ target: () => Event, inverseSide: 'eventSubscriberRuns' })
    event!: Event<T>;
    /**
     * The id of the subscriber.
     */
    @Property.string()
    subscriberId!: string;
    /**
     * The error property if the run failed.
     */
    @Property.unknown({ required: false })
    error?: Error;
}

/**
 * The data needed to create a new event subscriber run.
 */
export class EventSubscriberRunCreateData<T> extends OmitClass(EventSubscriberRun<unknown>, ['id', 'event', 'createdAt']) {
    /**
     * The event that triggered this run.
     */
    @Property.manyToOne({ target: () => Event, inverseSide: 'eventSubscriberRuns' })
    event!: Event<T>;
}