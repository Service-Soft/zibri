import { BaseScimProvisioner } from './base-scim-provisioner.ts';
import { Newable } from '../../types/newable.type.ts';
import { BaseUser } from '../models/base-user.model.ts';

/**
 * The provisioner a SCIM request is handled with.
 */
export type ScimProvisionerClass = Newable<BaseScimProvisioner<string, BaseUser<string>>>;