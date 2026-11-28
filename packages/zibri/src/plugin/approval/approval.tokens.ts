/* eslint-disable jsdoc/require-jsdoc */
import { TokenRecord } from '../../di/models/di-token.model';
import { DiVariant } from '../../di/models/di-variant.model';
import { InjectionToken } from '../../di/models/injection-token.model';
import { ApprovalPluginOptionsInput } from './models/approval-plugin-options-input.model';
import { ApprovalPluginOptions } from './models/approval-plugin-options.model';
import { ApprovalRequestServiceInterface } from './services/approval-request-service.interface';

/**
 * The dependency injection tokens used by the ZibriApprovalPlugin.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_APPROVAL_PLUGIN_DI_TOKENS = {
    OPTIONS_INPUT: approvalToken<ApprovalPluginOptionsInput>('zi.approval.options_input'),
    OPTIONS: approvalToken<ApprovalPluginOptions>('zi.approval.options'),
    APPROVAL_REQUEST_SERVICE: approvalToken<ApprovalRequestServiceInterface>('zi.approval.approval_request_service')
} as const satisfies TokenRecord;

/**
 * The variant of the providers of approval actions, which `provideApprovalAction` gives them.
 */
export const APPROVAL_ACTION_DI_VARIANT: DiVariant = new DiVariant('approval-action');

function approvalToken<T = never>(k: `zi.approval.${string}`): InjectionToken<T> {
    return new InjectionToken<T>(k);
}