import { Newable } from '../../types/newable.type';
import { BaseScimProvisioner } from './base-scim-provisioner';

/**
 * The provisioner a SCIM request is handled with.
 */
export type ScimProvisionerClass = Newable<BaseScimProvisioner>;