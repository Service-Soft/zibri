import { type ServiceAccountApiKeyModel } from './service-account-api-key.model';

/**
 * An API key just created for a service account, as `POST /:serviceAccountId/api-keys` of the routes of the service
 * accounts answers it: the stored key and the key itself, which no route answers again.
 */
export type CreatedServiceAccountApiKeyModel = {
    /**
     * The key as it is stored.
     */
    apiKey: ServiceAccountApiKeyModel,
    /**
     * The key itself, which the client sends in the API key header, or as its client secret at the token endpoint.
     */
    key: string
};
