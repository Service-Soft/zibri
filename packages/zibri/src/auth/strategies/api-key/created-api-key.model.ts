import { ApiKey } from './api-key.model';

/**
 * An api key that was just created as a secret.
 */
export type CreatedApiKey = {
    /**
     * The key as it is stored.
     */
    apiKey: ApiKey,
    /**
     * The key itself, for its holder to send in the api key header, or as the client secret at the
     * token endpoint. It is only ever handed out here.
     */
    key: string
};