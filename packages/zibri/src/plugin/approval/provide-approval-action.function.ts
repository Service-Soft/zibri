import { DiProvider } from '../../di/models/di-provider.model';
import { InjectionToken } from '../../di/models/injection-token.model';
import { APPROVAL_ACTION_DI_VARIANT } from './approval.tokens';
import { type ApprovalAction } from './models/approval-action.model';

/**
 * Registers an action that can be proposed for approval, for the `providers` of an application or a plugin.
 * @param action - The action.
 * @returns The provider of the action.
 */
export function provideApprovalAction<Input extends object, Result>(action: ApprovalAction<Input, Result>): DiProvider<ApprovalAction> {
    return {
        token: new InjectionToken<ApprovalAction>(`zi.approval.action.${action.name}`),
        // an action of any input is one of object input, see the methods of ApprovalAction
        useValue: action,
        variants: [APPROVAL_ACTION_DI_VARIANT]
    };
}