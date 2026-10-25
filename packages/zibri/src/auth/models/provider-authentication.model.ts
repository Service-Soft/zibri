/**
 * How the user proved who they are at a provider, as the provider reports it with the sign-in.
 */
export type ProviderAuthentication = {
    /**
     * The methods, as the `amr` claim of an ID token names them: `pwd`, `otp`, `hwk`, `mfa` and the
     * like. Empty when the provider does not say.
     */
    methods: string[],
    /**
     * The class of the authentication: the `acr` claim of an ID token, or the AuthnContextClassRef of
     * a SAML assertion. Undefined when the provider does not say.
     */
    contextClass: string | undefined
};