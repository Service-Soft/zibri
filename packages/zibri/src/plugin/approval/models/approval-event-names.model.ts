import { type EventTypeFor } from '../../../event/event-type-for.type';
import { type ApprovalRequestEventData } from './approval-request-event-data.model';

/**
 * Which changes of approval requests are emitted as events, each under a type your `ZibriEventMap` declares. A change
 * left out is emitted as no event.
 */
export type ApprovalEventNames = {
    /**
     * A request proposed, before a policy decides it.
     */
    requestCreated?: EventTypeFor<ApprovalRequestEventData>,
    /**
     * A request approved, by a user or a policy, or rejected.
     */
    requestDecided?: EventTypeFor<ApprovalRequestEventData>
};