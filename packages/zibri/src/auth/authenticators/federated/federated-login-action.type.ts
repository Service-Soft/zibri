import { AuditAction } from '../../../logging/audit-event.model';

/**
 * What a login at a provider is for, as the audit trail records it: a login, or connecting the
 * provider to the account of a user who is logged in.
 */
export type FederatedLoginAction = AuditAction.LOGIN | AuditAction.IDENTITY_LINKED;