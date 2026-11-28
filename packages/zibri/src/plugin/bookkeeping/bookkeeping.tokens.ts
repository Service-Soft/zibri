/* eslint-disable jsdoc/require-jsdoc */
import { type KeptRowCheckInterface } from '../../backup/kept-row-check.interface';
import { TokenRecord } from '../../di/models/di-token.model';
import { InjectionToken } from '../../di/models/injection-token.model';
import { type BankMatchPostingInterface } from '../bank/services/bank-match-posting.interface';
import { type BankMatcherInterface } from '../bank/services/bank-matcher.interface';
import { type Newable } from '../../types/newable.type';
import { type InvoicePostingInterface } from '../invoicing/services/invoice-posting.interface';
import { type BookkeepingCompany } from './models/bookkeeping-company.model';
import { BookkeepingPluginOptionsInput } from './models/bookkeeping-plugin-options-input.model';
import { BookkeepingPluginOptions } from './models/bookkeeping-plugin-options.model';
import { type BookkeepingStatementStructure } from './models/bookkeeping-statement-structure.model';
import { type BookkeepingReportPdfServiceInterface } from './services/bookkeeping-report-pdf-service.interface';
import { type BookkeepingReportServiceInterface } from './services/bookkeeping-report-service.interface';
import { BookkeepingConformanceServiceInterface } from './services/conformance/bookkeeping-conformance-service.interface';
import { type ExpenseServiceInterface } from './services/expense-service.interface';
import { type BookkeepingExportServiceInterface } from './services/export/bookkeeping-export-service.interface';
import { type BookkeepingExporterInterface } from './services/export/bookkeeping-exporter.interface';
import { JournalServiceInterface } from './services/journal-service.interface';
import { type PostingRuleServiceInterface } from './services/posting-rule-service.interface';
import { type PostingServiceInterface } from './services/posting-service.interface';

/**
 * The dependency injection tokens used by the ZibriBookkeepingPlugin.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS = {
    OPTIONS_INPUT: bookkeepingToken<BookkeepingPluginOptionsInput>('zi.bookkeeping.options_input'),
    OPTIONS: bookkeepingToken<BookkeepingPluginOptions>('zi.bookkeeping.options'),
    JOURNAL_SERVICE: bookkeepingToken<JournalServiceInterface>('zi.bookkeeping.journal_service'),
    // the class of the company of the settings, BookkeepingCompany by default: a law asking more of the company, such
    // as the E-Bilanz, has the application register a class extending it, which the settings are then validated,
    // described and stored by
    COMPANY_MODEL: bookkeepingToken<Newable<BookkeepingCompany>>('zi.bookkeeping.company_model'),
    // those of the German corporations by default, each applying to a fiscal year by the legal form at its end: the
    // core knows no law, which lives in these and in the statement structures
    BOOKKEEPING_CONFORMANCE_SERVICES: bookkeepingToken<BookkeepingConformanceServiceInterface[]>('zi.bookkeeping.conformance_services'),
    // the forms of the statements as data, those of the HGB by default
    STATEMENT_STRUCTURES: bookkeepingToken<BookkeepingStatementStructure[]>('zi.bookkeeping.statement_structures'),
    REPORT_SERVICE: bookkeepingToken<BookkeepingReportServiceInterface>('zi.bookkeeping.report_service'),
    REPORT_PDF_SERVICE: bookkeepingToken<BookkeepingReportPdfServiceInterface>('zi.bookkeeping.report_pdf_service'),
    POSTING_SERVICE: bookkeepingToken<PostingServiceInterface>('zi.bookkeeping.posting_service'),
    POSTING_RULE_SERVICE: bookkeepingToken<PostingRuleServiceInterface>('zi.bookkeeping.posting_rule_service'),
    EXPENSE_SERVICE: bookkeepingToken<ExpenseServiceInterface>('zi.bookkeeping.expense_service'),
    EXPORT_SERVICE: bookkeepingToken<BookkeepingExportServiceInterface>('zi.bookkeeping.export_service'),
    // the format the export of a fiscal year is written in, the description standard of the German tax
    // administration by default: a format of another law, or a later one, replaces it
    EXPORTER: bookkeepingToken<BookkeepingExporterInterface>('zi.bookkeeping.exporter'),
    // the name of the store of the receipts and the archived statements, read by ExpenseReceipt.file and
    // FiscalYearStatement.file, which name their store by a token
    RECEIPT_FILE_STORE: bookkeepingToken<string>('zi.bookkeeping.receipt_file_store'),
    // the posting service, as the posting of issued invoices the invoicing plugin hands them to, by its variant
    INVOICE_POSTING: bookkeepingToken<InvoicePostingInterface>('zi.bookkeeping.invoice_posting'),
    // the posting service, as the posting of bank matches the bank plugin hands them to, by its variant
    BANK_MATCH_POSTING: bookkeepingToken<BankMatchPostingInterface>('zi.bookkeeping.bank_match_posting'),
    // the matchers of expenses and of accounts, which the bank plugin finds by their variant
    EXPENSE_BANK_MATCHER: bookkeepingToken<BankMatcherInterface>('zi.bookkeeping.expense_bank_matcher'),
    ACCOUNT_BANK_MATCHER: bookkeepingToken<BankMatcherInterface>('zi.bookkeeping.account_bank_matcher'),
    // the posting service, as one of the checks a restore of a tenant asks, which it finds by their variant
    KEPT_ROW_CHECK: bookkeepingToken<KeptRowCheckInterface>('zi.bookkeeping.kept_row_check')
} as const satisfies TokenRecord;

function bookkeepingToken<T = never>(k: `zi.bookkeeping.${string}`): InjectionToken<T> {
    return new InjectionToken<T>(k);
}
