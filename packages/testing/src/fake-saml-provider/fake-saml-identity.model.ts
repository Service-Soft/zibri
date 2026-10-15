/**
 * Who a fake SAML identity provider signs in.
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
    attributes: Record<string, string | string[]>
};