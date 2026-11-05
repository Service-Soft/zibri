/**
 * Who a fake SAML identity provider logs in.
 */
export type FakeSamlIdentity = {
    /**
     * The NameID the user is named by.
     */
    nameId: string,
    /**
     * The format of the NameID. The format the request asked for, when undefined.
     */
    nameIdFormat?: string,
    /**
     * The attributes sent about the user, by name.
     */
    attributes: Record<string, string | string[]>,
    /**
     * How the user logged in, as the AuthnContextClassRef of the assertion says. A password over a
     * protected connection, when undefined.
     */
    authnContextClassRef?: string
};