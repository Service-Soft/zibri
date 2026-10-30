import { ZibriEventMap } from './event-service.interface';

/**
 * The event types of `ZibriEventMap` an event carrying the given data can be emitted as: those whose
 * declared payload the data fits.
 */
export type EventTypeFor<Data> = {
    [K in keyof ZibriEventMap]: Data extends ZibriEventMap[K] ? K : never
}[keyof ZibriEventMap];