import { Property } from '../../entity/decorators/property.decorator';
import { ServiceAccountApiKey } from './service-account-api-key.model';

/**
 * An API key just created for a service account, as `POST /:serviceAccountId/api-keys` of the
 * `ServiceAccountController` answers it: the stored key and the key itself, which no route answers again.
 */
export class CreatedServiceAccountApiKey {
    /**
     * The key as it is stored.
     */
    @Property.object({ cls: () => ServiceAccountApiKey })
    apiKey!: ServiceAccountApiKey;

    /**
     * The key itself, which the client sends in the API key header, or as its client secret at the token endpoint.
     */
    @Property.string()
    key!: string;
}