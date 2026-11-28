/**
 * What the routes of the service accounts of Zibri take at most, so that a frontend checks a value before it sends it.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_SERVICE_ACCOUNT_LIMITS = {
    /**
     * The longest name of a service account, the local part of its email.
     */
    NAME_MAX_LENGTH: 64,
    /**
     * The longest name of an API key.
     */
    API_KEY_NAME_MAX_LENGTH: 200
} as const;
