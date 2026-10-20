import { BaseMembership } from './base-membership.model.ts';

/**
 * A user and the tenant whose membership of theirs was created, changed or deleted.
 */
export type ChangedMembership = Pick<BaseMembership<string>, 'userId' | 'tenantId'>;