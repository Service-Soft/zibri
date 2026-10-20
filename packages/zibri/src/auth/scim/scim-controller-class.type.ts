import { ScimProvisionerClass } from './scim-provisioner-class.type.ts';

/**
 * A controller class `ScimController` defined.
 */
export type ScimControllerClass = {
    /**
     * The provisioner its routes provision with.
     */
    scimProvisioner: ScimProvisionerClass
};