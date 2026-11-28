import { type EBilanzAccountMappingChangeModel } from './e-bilanz-account-mapping-change.model';

/**
 * An account of the books mapped to a position of the taxonomy of its own, in place of the position its statement
 * position maps to, as `GET /e-bilanz/account-mappings` answers it. At most one per account.
 */
export type EBilanzAccountMappingModel = EBilanzAccountMappingChangeModel & {
    /**
     * The id of the mapping.
     */
    id: string,
    /**
     * The tenant keeping the books.
     */
    tenantId: string,
    /**
     * The id of the account.
     */
    accountId: string
};
