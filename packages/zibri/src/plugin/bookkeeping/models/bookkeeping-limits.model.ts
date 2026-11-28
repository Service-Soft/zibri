/* eslint-disable typescript/typedef */
import { type FileSize } from '../../../entity/models/file-property-metadata.model';

/**
 * What the bookkeeping plugin takes at most.
 */
export abstract class BookkeepingLimits {
    /**
     * The longest name of an account or a supplier, and the longest legal form.
     */
    static readonly NAME_MAX_LENGTH = 200;
    /**
     * The longest number of an account.
     */
    static readonly ACCOUNT_NUMBER_MAX_LENGTH = 20;
    /**
     * The longest position of a statement an account is reported in.
     */
    static readonly STATEMENT_POSITION_MAX_LENGTH = 200;
    /**
     * The longest text of an entry.
     */
    static readonly TEXT_MAX_LENGTH = 500;
    /**
     * The longest note below the balance sheet of a fiscal year.
     */
    static readonly NOTE_MAX_LENGTH = 10_000;
    /**
     * The longest number of the document of an entry or an expense.
     */
    static readonly DOCUMENT_REFERENCE_MAX_LENGTH = 100;
    /**
     * The most lines an entry posted through a route has. The opening balances of a fiscal year have a line per
     * account, however many there are.
     */
    static readonly LINES_MAX_COUNT = 1000;
    /**
     * The longest name of a conformance.
     */
    static readonly CONFORMANCE_NAME_MAX_LENGTH = 100;
    /**
     * The longest VAT category code of a posting rule, such as `AE`.
     */
    static readonly VAT_CATEGORY_CODE_MAX_LENGTH = 10;
    /**
     * The longest address of a supplier.
     */
    static readonly ADDRESS_MAX_LENGTH = 500;
    /**
     * The longest VAT identification number of a supplier.
     */
    static readonly VAT_ID_MAX_LENGTH = 30;
    /**
     * The longest IBAN of an account match rule.
     */
    static readonly IBAN_MAX_LENGTH = 50;
    /**
     * The longest text of an account match rule.
     */
    static readonly MATCH_TEXT_MAX_LENGTH = 200;
    /**
     * The largest receipt of an expense.
     */
    static readonly RECEIPT_MAX_SIZE: FileSize = '25mb';
    /**
     * The largest pdf of a statement archived at closing.
     */
    static readonly STATEMENT_MAX_SIZE: FileSize = '25mb';
}