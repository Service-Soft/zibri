import { type TenantS3TransportSecretModel } from 'zibri-contract';

import { Property } from '../../entity/decorators/property.decorator';

/**
 * The secret a tenant's bucket is reached with: the secret of its access key.
 */
export class TenantS3TransportSecret implements TenantS3TransportSecretModel {
    /**
     * The secret of the access key.
     */
    @Property.string()
    secretAccessKey!: string;
}