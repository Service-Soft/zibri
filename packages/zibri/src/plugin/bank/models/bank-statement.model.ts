import { BaseArchivedEntity } from '../../../archive/base-archived-entity.model';
import { Archive } from '../../../archive/decorators/archive.decorator';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { MimeType } from '../../../http/mime-type.enum';
import { BigNumber } from '../../../utilities/number.utilities';
import { ZIBRI_BANK_PLUGIN_DI_TOKENS } from '../bank.tokens';
import { BankLimits } from './bank-limits.model';

/**
 * A statement of a bank account, imported from a CAMT.053 file: the period it covers, its opening and closing
 * balance, and the original file, archived for the retention of the bank plugin.
 */
// the retention here is the default of the plugin, which counts each row's retainUntil from its options instead
@Entity({ allowOrphan: true, chained: true, uniques: [['accountId', 'bankStatementId']] })
@Archive({ retention: { years: 8 }, dateProperty: 'issuedAt' })
export class BankStatement extends BaseArchivedEntity {
    /**
     * The tenant the statement belongs to.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The id of the bank account the statement is of.
     */
    @Property.string({ format: 'uuid' })
    accountId!: string;

    /**
     * The id the bank gave the statement. Unique among the statements of its account.
     */
    @Property.string()
    bankStatementId!: string;

    /**
     * The number the bank counts the statements of the account with, if it names one.
     */
    @Property.number({ format: 'integer', required: false })
    electronicSequenceNumber?: number | null;

    /**
     * When the bank created the statement, from the end of whose year the retention is counted.
     */
    @Property.date()
    issuedAt!: Date;

    /**
     * The start of the period the statement covers.
     */
    @Property.date()
    periodStart!: Date;

    /**
     * The end of the period the statement covers.
     */
    @Property.date()
    periodEnd!: Date;

    /**
     * The booked balance at the start of the period, negative below zero.
     */
    @Property.number({ format: 'bignumber' })
    openingBalance!: BigNumber;

    /**
     * The date of the opening balance.
     */
    @Property.date()
    openingBalanceDate!: Date;

    /**
     * The booked balance at the end of the period, negative below zero, which the next statement opens with.
     */
    @Property.number({ format: 'bignumber' })
    closingBalance!: BigNumber;

    /**
     * The date of the closing balance.
     */
    @Property.date()
    closingBalanceDate!: Date;

    /**
     * The currency of the balances, such as `EUR`.
     */
    @Property.string({ regex: BankLimits.CURRENCY_REGEX })
    currency!: string;

    /**
     * The version of CAMT.053 the file is written in: `camt.053.001.02` or `camt.053.001.08`.
     */
    @Property.string()
    format!: string;

    /**
     * The original file the statement was imported from, kept in the file store `store` of the bank plugin options
     * names, `bank-statements` by default.
     */
    @Property.file({
        store: ZIBRI_BANK_PLUGIN_DI_TOKENS.STATEMENT_FILE_STORE,
        allowedMimeTypes: [MimeType.XML],
        maxSize: BankLimits.FILE_MAX_SIZE
    })
    file!: string;

    /**
     * When the statement was imported.
     */
    @Property.date()
    importedAt!: Date;

    /**
     * The user who imported the statement, or null when no user did.
     */
    @Property.string({ required: false })
    importedBy?: string | null;
}