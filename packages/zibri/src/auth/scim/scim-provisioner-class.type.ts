import { BaseScimProvisioner } from './base-scim-provisioner';
import { Newable } from '../../types/newable.type';
import { BaseUser } from '../models/base-user.model';

/**
 * The provisioner a SCIM request is handled with.
 */
export type ScimProvisionerClass = Newable<BaseScimProvisioner<string, BaseUser<string>>>;