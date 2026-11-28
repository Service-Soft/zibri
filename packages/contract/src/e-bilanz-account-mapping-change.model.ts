/**
 * The position of the taxonomy an account reports as, as `PUT /e-bilanz/account-mappings/:accountId` takes it.
 */
export type EBilanzAccountMappingChangeModel = {
    /**
     * The element name of the position, such as `bs.ass.currAss.cashEquiv.bank`.
     */
    position: string,
    /**
     * The element name of the position it reports as while its balance is a credit, or null for `position`.
     */
    creditPosition?: string | null
};
