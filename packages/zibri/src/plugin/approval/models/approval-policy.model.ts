import { type ApprovalActionDescription } from './approval-action-description.model';
import { type ApprovalRequest } from './approval-request.model';

/**
 * A rule that approves the requests of an action without a person, such as a match suggested with a confidence of
 * at least 0.95. The decision names the policy as the one that approved it.
 */
export type ApprovalPolicy<Input extends object> = {
    /**
     * The name the decision records, such as `confidence-at-least-0.95`.
     */
    readonly name: string,
    /**
     * Whether the policy approves a request, once it is proposed.
     * @param input - What the action runs with.
     * @param request - The request, as it is stored.
     * @param description - What the action answered for the reviewer.
     */
    // a method, for the reason ApprovalAction declares describe as one
    // eslint-disable-next-line typescript/method-signature-style
    approves(input: Input, request: ApprovalRequest, description: ApprovalActionDescription): boolean | Promise<boolean>
};