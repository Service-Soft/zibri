import { type ApprovalPluginOptions } from './approval-plugin-options.model';

/**
 * Input for configuring the approval plugin: how long a request waits, unless 7 days, and the events emitted.
 */
export type ApprovalPluginOptionsInput = Partial<ApprovalPluginOptions>;