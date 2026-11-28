/**
 * A rule suggesting the account of the books a bank transaction is matched with, as
 * `POST /bookkeeping/account-match-rules` takes it. It applies to a transaction that has what it names: the IBAN of
 * the counterparty, the text, or both.
 */
export type NewAccountMatchRuleModel = {
    /**
     * The id of the account suggested, such as the share capital.
     */
    accountId: string,
    /**
     * The IBAN of the counterparty, or null for any.
     */
    counterpartyIban?: string | null,
    /**
     * A text the remittance information or the name of the counterparty holds, in any case, or null for any.
     */
    text?: string | null
};