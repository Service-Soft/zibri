import { type ZibriEventMap } from './event-service.interface';

/**
 * Which failed runs to offer to their subscribers again.
 *
 * Every filter that is given narrows the selection, and a filter that is left out does not. `{}`
 * selects every failed run.
 */
export type EventReplayOptions = {
    /**
     * Only the runs of these events.
     */
    eventIds?: string[],
    /**
     * Only the runs of these subscribers.
     */
    subscriberIds?: string[],
    /**
     * Only the runs of events of these types.
     */
    types?: (keyof ZibriEventMap)[],
    /**
     * Whether to reach the failed runs of every tenant, rather than those of the active one.
     */
    acrossTenants?: boolean
};