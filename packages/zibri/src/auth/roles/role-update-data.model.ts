import { BaseRole } from './base-role.model';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * What changes about a role. Not its name, level or tenant, which its holders depend on.
 */
export type RoleUpdateData<T extends BaseRole> = Partial<OmitStrict<T, 'id' | 'name' | 'level' | 'tenantId'>>;