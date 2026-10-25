import { BaseRole } from './base-role.model';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * What a new role is created with: what the application's role entity holds. A permission that is
 * not declared at the role's level is refused. Without a `tenantId` the role is one every tenant
 * shares; with one, a tenant role of that tenant's own.
 */
export type RoleCreateData<T extends BaseRole> = OmitStrict<T, 'id'>;