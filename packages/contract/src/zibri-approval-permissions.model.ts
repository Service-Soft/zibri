import { DefinedPermissions, definePermissions } from './define-permissions.function';

/**
 * The tenant permissions the approval request routes of Zibri check, in the tenant a request acts in: reading the
 * approval requests of that tenant, and deciding them. Deciding one also takes the permission its action names. Spread
 * them into the tenant permissions of the application.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_APPROVAL_PERMISSIONS = [
    'approval-requests.read',
    'approval-requests.decide'
] as const;

/**
 * {@link ZIBRI_APPROVAL_PERMISSIONS}, by name.
 */
export const ZibriApprovalPermissions: DefinedPermissions<typeof ZIBRI_APPROVAL_PERMISSIONS>
    = definePermissions(ZIBRI_APPROVAL_PERMISSIONS);