/**
 * Which second factor presented at the provider a login went through counts for a route guarded by
 * \@Auth.require2fa, in place of one presented to the application.
 *
 * `false` counts none. Otherwise a login counts whose provider reported one of the `methods`, or one
 * of the `contextClasses`.
 */
export type Require2faProviderFactors = false | {
    /**
     * The methods that count, as the `amr` claim of an ID token names them, eg. `['mfa', 'otp', 'hwk']`.
     */
    methods?: string[],
    /**
     * The classes of authentication that count: `acr` values of an ID token, or the
     * AuthnContextClassRefs of a SAML assertion.
     */
    contextClasses?: string[]
};