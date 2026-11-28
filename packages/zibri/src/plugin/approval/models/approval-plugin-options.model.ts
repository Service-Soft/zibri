import { type ApprovalEventNames } from './approval-event-names.model';

/**
 * Configuration for the approval plugin.
 */
export type ApprovalPluginOptions = {
    /**
     * How long a request of an action that names no `expiresInMs` waits for a decision.
     * @default 7 days
     */
    readonly expiresInMs: number,
    /**
     * Which changes of approval requests are emitted as events.
     * @default {}
     */
    readonly eventNames: ApprovalEventNames
};