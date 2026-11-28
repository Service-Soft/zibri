import { type Permission } from '../../../auth/roles/permission.type';
import { Newable } from '../../../types/newable.type';
import { type ApprovalActionDescription } from './approval-action-description.model';
import { type ApprovalPolicy } from './approval-policy.model';
import { type ApprovalRunContext } from './approval-run-context.model';

/**
 * Something an actor may propose and a person approves before it runs, such as closing a task. Registered by its
 * `name` with `provideApprovalAction`.
 */
export type ApprovalAction<Input extends object = object, Result = unknown> = {
    /**
     * The name the requests of the action are stored with, such as `tasks.close`. Unique among the actions.
     */
    readonly name: string,
    /**
     * The model of the input, which a proposal is validated against.
     */
    readonly input: Newable<Input>,
    /**
     * The tenant permission it takes to approve or reject a request of the action.
     */
    readonly permission: Permission,
    /**
     * The tenant permission it takes a user to propose the action.
     */
    readonly proposePermission: Permission,
    /**
     * Whether approving a request takes a second factor of the approver. False by default.
     */
    readonly require2fa?: boolean,
    /**
     * How long a request waits for a decision. The `expiresInMs` of the plugin options by default, 7 days.
     */
    readonly expiresInMs?: number,
    /**
     * The policies that approve a request without a person, asked in order once it is proposed. None by default.
     */
    readonly policies?: ApprovalPolicy<Input>[],
    /**
     * Says what the action would do with an input: a summary for the reviewer, and the rows it writes. Called when a
     * request is proposed, and again when it is approved, to check that the rows did not change.
     * @param input - What the action runs with.
     */
    // methods rather than function properties, for their parameters are checked in both directions: an action of any input
    // is then an ApprovalAction of object input, which the registry of the actions of every input holds. A function
    // property would make Input invariant, and leave `any` the one type to hold them by
    // eslint-disable-next-line typescript/method-signature-style
    describe(input: Input): Promise<ApprovalActionDescription>,
    /**
     * Runs the action once its request is approved, as the approver. What it answers is recorded with the decision.
     * @param input - What the action runs with.
     * @param context - The transaction to write through, the request and who approved it.
     */
    // eslint-disable-next-line typescript/method-signature-style
    run(input: Input, context: ApprovalRunContext): Promise<Result>
};