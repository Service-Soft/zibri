import { BaseScimProvisioner } from './base-scim-provisioner';
import { Newable } from '../../types/newable.type';

/**
 * The provisioner a SCIM request is handled with.
 */
export type ScimProvisionerClass = Newable<BaseScimProvisioner>;