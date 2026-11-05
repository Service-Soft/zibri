import { type BaseMembership } from './base-membership.model';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * The membership a request acts through in the active tenant, as a handler or a scope is handed it:
 * without its roles. What the caller may do there is in the `permissions` of their `CurrentUser`.
 */
export type CurrentMembership<MembershipType extends BaseMembership<string> = BaseMembership<string>> = OmitStrict<MembershipType, 'roles'>;