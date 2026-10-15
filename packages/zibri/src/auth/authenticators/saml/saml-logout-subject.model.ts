/**
 * What a logout request to a SAML identity provider names: the user, as the identity provider named
 * them when they signed in, and the session.
 */
export type SamlLogoutSubject = {
    /**
     * The NameID.
     */
    nameID: string,
    /**
     * Its format.
     */
    nameIDFormat: string,
    /**
     * The qualifier of the identity provider the NameID came with, if any.
     */
    nameQualifier: string | undefined,
    /**
     * The qualifier of the service provider the NameID came with, if any.
     */
    spNameQualifier: string | undefined,
    /**
     * The session at the identity provider, if it named one.
     */
    sessionIndex: string | undefined
};