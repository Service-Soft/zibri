import { Event } from './event.model';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitStrict } from '../types/omit-strict.type';

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
     * The error property if the run failed.
     */
    @Property.unknown({ required: false })
    error?: Error | null;
}

/**
 * The data needed to create a new event subscriber run.
 */
export type EventSubscriberRunCreateData<T> = OmitStrict<EventSubscriberRun<T>, 'id' | 'eventId' | 'createdAt'>;