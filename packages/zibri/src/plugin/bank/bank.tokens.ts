/* eslint-disable jsdoc/require-jsdoc */
import { type KeptRowCheckInterface } from '../../backup/kept-row-check.interface';
import { TokenRecord } from '../../di/models/di-token.model';
import { DiVariant } from '../../di/models/di-variant.model';
import { InjectionToken } from '../../di/models/injection-token.model';
import { type ApprovalAction } from '../approval/models/approval-action.model';
import { type InvoicePaymentSourceInterface } from '../invoicing/services/invoice-payment-source.interface';
import { type BankMatchInput } from './models/bank-match-input.model';
import { type BankMatch } from './models/bank-match.model';
import { BankPluginOptionsInput } from './models/bank-plugin-options-input.model';
import { BankPluginOptions } from './models/bank-plugin-options.model';
import { type BankMatchServiceInterface } from './services/bank-match-service.interface';
import { BankStatementServiceInterface } from './services/bank-statement-service.interface';

/**
 * The dependency injection tokens used by the ZibriBankPlugin.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_BANK_PLUGIN_DI_TOKENS = {
    OPTIONS_INPUT: bankToken<BankPluginOptionsInput>('zi.bank.options_input'),
    OPTIONS: bankToken<BankPluginOptions>('zi.bank.options'),
    // the name of the store of the original files, read by BankStatement.file, which names its store by a token
    STATEMENT_FILE_STORE: bankToken<string>('zi.bank.statement_file_store'),
    BANK_STATEMENT_SERVICE: bankToken<BankStatementServiceInterface>('zi.bank.bank_statement_service'),
    BANK_MATCH_SERVICE: bankToken<BankMatchServiceInterface>('zi.bank.bank_match_service'),
    // the match service, as one of the payment sources the invoicing plugin asks, which it finds by their variant
    INVOICE_PAYMENT_SOURCE: bankToken<InvoicePaymentSourceInterface>('zi.bank.invoice_payment_source'),
    // the action bank.match, which the approval plugin finds by its variant
    BANK_MATCH_APPROVAL_ACTION: bankToken<ApprovalAction<BankMatchInput, BankMatch>>('zi.bank.bank_match_approval_action'),
    // the match service, as one of the checks a restore of a tenant asks, which it finds by their variant
    KEPT_ROW_CHECK: bankToken<KeptRowCheckInterface>('zi.bank.kept_row_check')
} as const satisfies TokenRecord;

/**
 * The variant of the providers of matchers of targets other than invoices, such as the expenses and the accounts of
 * the bookkeeping plugin. Each implements `BankMatcherInterface`.
 */
export const BANK_MATCHER_DI_VARIANT: DiVariant = new DiVariant('bank-matcher');

/**
 * The variant of the providers that book the matches of bank transactions, such as the one of the bookkeeping plugin.
 * Each implements `BankMatchPostingInterface`, and is handed every match and its reversal as they are written.
 */
export const BANK_MATCH_POSTING_DI_VARIANT: DiVariant = new DiVariant('bank-match-posting');

function bankToken<T = never>(k: `zi.bank.${string}`): InjectionToken<T> {
    return new InjectionToken<T>(k);
}