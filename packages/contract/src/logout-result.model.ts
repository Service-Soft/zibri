/**
 * What a logout answers.
 */
export type LogoutResult = {
    /**
     * Where to send the browser to log out at the provider the login was started at too, like Google.
     */
    providerLogoutUrl?: string
};