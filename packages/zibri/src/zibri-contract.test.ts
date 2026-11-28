import { describe, expect, it } from '@jest/globals';
import * as Contract from 'zibri-contract';

import { Equals } from './__testing__/equals.type';
import { Json } from './__testing__/json.type';
import * as Zibri from './__testing__/public-entry-points';

// the types of zibri-contract are what a frontend reads the responses of zibri with, and what it sends. Each is
// compared with the model zibri declares, as it arrives as json: a mismatch fails the typecheck, which is where these
// checks run. The bodies of the errors of a login that waits for a step are typed by the contract where zibri builds
// them, so they need no check here.

/**
 * The roles of an application, which both sides take as a parameter.
 */
type Role = 'admin' | 'user';

/**
 * A row of a page, which both sides take as a parameter.
 */
type Row = {
    /**
     * The id of the row.
     */
    id: string
};

describe('the types of zibri-contract', () => {
    it('are the enums zibri declares, rather than a copy of them', () => {
        expect(Zibri.LogLevel).toBe(Contract.LogLevel);
        expect(Zibri.ChangeSetType).toBe(Contract.ChangeSetType);
    });

    // the contract library of an api declares the permissions of the application with zibri's own spread in, in a
    // browser, which cannot import zibri: both sides have to make the same permissions
    it('are the permissions zibri declares and makes, rather than a copy of them', () => {
        expect(Zibri.ZIBRI_PERMISSIONS).toBe(Contract.ZIBRI_PERMISSIONS);
        expect(Zibri.ZIBRI_PLATFORM_PERMISSIONS).toBe(Contract.ZIBRI_PLATFORM_PERMISSIONS);
        expect(Zibri.ZibriPermissions).toBe(Contract.ZibriPermissions);
        expect(Zibri.ZibriPlatformPermissions).toBe(Contract.ZibriPlatformPermissions);
        expect(Zibri.definePermissions).toBe(Contract.definePermissions);
        expect(Zibri.definePlatformPermissions).toBe(Contract.definePlatformPermissions);

        // a permission the contract makes is one zibri takes, and one of the other level is refused by both
        const permissions: Contract.DefinedPermissions<readonly ['invoices.read']> = Contract.definePermissions(['invoices.read'] as const);
        const asked: Zibri.Permission = permissions.INVOICES_READ;
        // @ts-expect-error - a tenant permission is no platform permission, whichever package made it
        const wrong: Zibri.PlatformPermission = permissions.INVOICES_READ;
        expect([asked, wrong]).toEqual(['invoices.read', 'invoices.read']);
    });

    it('read a page and an error as zibri sends them', () => {
        const checks: true[] = [
            true satisfies Equals<Json<Zibri.PaginationResult<Row>>, Json<Contract.PaginationResult<Row>>>,
            true satisfies Equals<Json<Zibri.ErrorResponseBody>, Json<Contract.ErrorResponseBody>>,
            true satisfies Equals<Json<Zibri.ValidationProblem>, Json<Contract.ValidationProblem>>
        ];
        expect(checks).not.toContain(false);
    });

    it('read a file of an entity kept in a file store as zibri answers it', () => {
        const checks: true[] = [true satisfies Equals<Json<Zibri.FileReference>, Json<Contract.FileReference>>];
        expect(checks).not.toContain(false);
    });

    it('read and send what the auth of zibri answers and takes', () => {
        const checks: true[] = [
            true satisfies Equals<Json<Zibri.JwtAuthData<Role>>, Json<Contract.JwtAuthData<Role>>>,
            true satisfies Equals<Json<Zibri.CookieAuthData<Role>>, Json<Contract.CookieAuthData<Role>>>,
            true satisfies Equals<Json<Zibri.CsrfToken>, Json<Contract.CsrfToken>>,
            true satisfies Equals<Json<Zibri.LogoutResult>, Json<Contract.LogoutResult>>,
            true satisfies Equals<Json<Zibri.UserLogin>, Json<Contract.UserLogin>>,
            true satisfies Equals<Json<Zibri.CurrentUserProfile>, Json<Contract.CurrentUserProfile>>,
            true satisfies Equals<Json<Zibri.CurrentUserMembership>, Json<Contract.CurrentUserMembership>>,
            true satisfies Equals<Json<Zibri.TwoFactorRegistrations>, Json<Contract.TwoFactorRegistrations>>,
            true satisfies Equals<Json<Zibri.OtpRegistration>, Json<Contract.OtpRegistration>>,
            true satisfies Equals<Json<Zibri.OtpRegistrationConfirmData>, Json<Contract.OtpRegistrationConfirmData>>,
            true satisfies Equals<Json<Zibri.RecoveryCodeRegistration>, Json<Contract.RecoveryCodeRegistration>>,
            true satisfies Equals<Json<Zibri.CodeRegistrationConfirmData>, Json<Contract.CodeRegistrationConfirmData>>,
            // confirmed with a code like the codes that are sent
            true satisfies Equals<Json<Zibri.RecoveryCodeRegistrationConfirmData>, Json<Contract.CodeRegistrationConfirmData>>,
            true satisfies Equals<Json<Zibri.SmsRegistrationRequestData>, Json<Contract.SmsRegistrationRequestData>>,
            true satisfies Equals<Json<Zibri.EmailConfirmation>, Json<Contract.EmailConfirmation>>,
            true satisfies Equals<Json<Zibri.LinkedIdentity>, Json<Contract.LinkedIdentity>>,
            true satisfies Equals<Json<Zibri.PasswordResetTokenValidity>, Json<Contract.PasswordResetTokenValidity>>,
            true satisfies Equals<Json<Zibri.FederatedLinkIdentityStart>, Json<Contract.FederatedLinkIdentityStart>>,
            true satisfies Equals<Json<Zibri.PasskeyTicketCredentials>, Json<Contract.PasskeyTicketCredentials>>,
            true satisfies Equals<Json<Zibri.InvitationTokenValidity>, Json<Contract.InvitationTokenValidity>>,
            true satisfies Equals<Json<Zibri.AcceptInvitationInput>, Json<Contract.AcceptInvitationInput>>,
            true satisfies Equals<Json<Zibri.UpdateCurrentUserInput>, Json<Contract.UpdateCurrentUserInput>>,
            true satisfies Equals<Json<Zibri.LoginMethods>, Json<Contract.LoginMethods>>,
            true satisfies Equals<Json<Zibri.RequestLoginLinkInput>, Json<Contract.RequestLoginLinkInput>>,
            true satisfies Equals<Json<Zibri.LoginLinkCredentials>, Json<Contract.LoginLinkCredentials>>,
            // without the hash of its token, which a route of the application leaves out
            true satisfies Equals<Json<Omit<Zibri.BaseInvitation, 'token'>>, Json<Contract.Invitation>>,
            true satisfies Equals<Json<Zibri.RowShare>, Json<Contract.RowShareModel>>,
            true satisfies Equals<Json<Zibri.PendingRowShare>, Json<Contract.PendingRowShareModel>>,
            true satisfies Equals<Json<Zibri.TenantDeletion>, Json<Contract.TenantDeletion>>
        ];
        expect(checks).not.toContain(false);
    });

    it('send what the routes of the service accounts take, and read what they answer', () => {
        expect(Zibri.ZIBRI_SERVICE_ACCOUNT_PLATFORM_PERMISSIONS).toBe(Contract.ZIBRI_SERVICE_ACCOUNT_PLATFORM_PERMISSIONS);
        expect(Zibri.ZibriServiceAccountPlatformPermissions).toBe(Contract.ZibriServiceAccountPlatformPermissions);
        expect(Zibri.ZIBRI_SERVICE_ACCOUNT_LIMITS).toBe(Contract.ZIBRI_SERVICE_ACCOUNT_LIMITS);
        const checks: true[] = [
            true satisfies Equals<Zibri.UserKind, Contract.UserKind>,
            true satisfies Equals<Json<Zibri.ServiceAccount>, Json<Contract.ServiceAccountModel>>,
            true satisfies Equals<Json<Zibri.ServiceAccountApiKey>, Json<Contract.ServiceAccountApiKeyModel>>,
            true satisfies Equals<Json<Zibri.NewServiceAccount>, Json<Contract.NewServiceAccountModel>>,
            true satisfies Equals<Json<Zibri.ServiceAccountRoles>, Json<Contract.ServiceAccountRolesModel>>,
            true satisfies Equals<Json<Zibri.NewServiceAccountApiKey>, Json<Contract.NewServiceAccountApiKeyModel>>,
            true satisfies Equals<Json<Zibri.CreatedServiceAccountApiKey>, Json<Contract.CreatedServiceAccountApiKeyModel>>,
            true satisfies Equals<Json<Zibri.McpToolSummary>, Json<Contract.McpToolSummaryModel>>
        ];
        expect(checks).not.toContain(false);
    });

    it('read and send the logs of zibri', () => {
        const checks: true[] = [
            true satisfies Equals<Json<Zibri.LoggedError>, Json<Contract.LoggedError>>,
            true satisfies Equals<Json<Zibri.LogContext>, Json<Contract.LogContext>>,
            true satisfies Equals<Json<Zibri.Log>, Json<Contract.Log>>
        ];
        expect(checks).not.toContain(false);
    });

    // ngx-tracking sends the page views and events, and an admin app manages the sites and reads the counts, by these
    it('send the page views and events the analytics plugin takes, and read what it answers', () => {
        expect(Zibri.AnalyticsOperatingSystem).toBe(Contract.AnalyticsOperatingSystem);
        expect(Zibri.ZIBRI_ANALYTICS_PERMISSIONS).toBe(Contract.ZIBRI_ANALYTICS_PERMISSIONS);
        expect(Zibri.ZIBRI_ANALYTICS_PLATFORM_PERMISSIONS).toBe(Contract.ZIBRI_ANALYTICS_PLATFORM_PERMISSIONS);
        expect(Zibri.ZibriAnalyticsPermissions).toBe(Contract.ZibriAnalyticsPermissions);
        expect(Zibri.ZibriAnalyticsPlatformPermissions).toBe(Contract.ZibriAnalyticsPlatformPermissions);

        const checks: true[] = [
            true satisfies Equals<Json<Zibri.AnalyticsSiteDetails>, Json<Contract.AnalyticsSiteModel>>,
            true satisfies Equals<Json<Zibri.AnalyticsSite>, Json<Omit<Contract.AnalyticsSiteModel, 'verificationRecord'>>>,
            true satisfies Equals<Json<Zibri.AnalyticsSiteVerificationRecord>, Json<Contract.AnalyticsSiteVerificationRecordModel>>,
            true satisfies Equals<Json<Zibri.NewAnalyticsSite>, Json<Contract.NewAnalyticsSiteModel>>,
            true satisfies Equals<Json<Zibri.AnalyticsSource>, Json<Contract.AnalyticsSourceModel>>,
            true satisfies Equals<Json<Zibri.AnalyticsPageView>, Json<Contract.AnalyticsPageViewModel>>,
            true satisfies Equals<Json<Zibri.AnalyticsEvent>, Json<Contract.AnalyticsEventModel>>,
            true satisfies Equals<Json<Zibri.AnalyticsDay>, Json<Contract.AnalyticsDayModel>>,
            true satisfies Equals<Json<Zibri.AnalyticsPage>, Json<Contract.AnalyticsPageModel>>,
            true satisfies Equals<Json<Zibri.AnalyticsSourceCount>, Json<Contract.AnalyticsSourceCountModel>>,
            true satisfies Equals<Json<Zibri.AnalyticsSystem>, Json<Contract.AnalyticsSystemModel>>,
            true satisfies Equals<Json<Zibri.AnalyticsFunnelStep>, Json<Contract.AnalyticsFunnelStepModel>>,
            true satisfies Equals<Json<Zibri.AnalyticsFunnelSource>, Json<Contract.AnalyticsFunnelSourceModel>>,
            true satisfies Equals<Json<Zibri.AnalyticsFunnel>, Json<Contract.AnalyticsFunnelModel>>
        ];
        expect(checks).not.toContain(false);
    });

    // a frontend adds the bank accounts of a tenant, uploads their statements, lists them, their transactions and what
    // the transactions are matched with
    it('send what the bank plugin takes, and read what it answers', () => {
        expect(Zibri.ZIBRI_BANK_PERMISSIONS).toBe(Contract.ZIBRI_BANK_PERMISSIONS);
        expect(Zibri.ZibriBankPermissions).toBe(Contract.ZibriBankPermissions);
        expect(Zibri.BankMatchTargetType).toBe(Contract.BankMatchTargetType);
        expect(Zibri.BankMatchReason).toBe(Contract.BankMatchReason);
        expect(Zibri.BankTransactionStatus).toBe(Contract.BankTransactionStatus);

        const checks: true[] = [
            true satisfies Equals<Json<Zibri.BankAccount>, Json<Contract.BankAccountModel>>,
            true satisfies Equals<Json<Zibri.NewBankAccount>, Json<Contract.NewBankAccountModel>>,
            true satisfies Equals<Json<Zibri.ArchivedFile>, Json<Contract.ArchivedFileModel>>,
            // a file kept in a file store is answered as its FileReference, in place of the id the row holds
            true satisfies Equals<Json<Omit<Zibri.BankStatement, 'file'>>, Json<Omit<Contract.BankStatementModel, 'file'>>>,
            true satisfies Equals<Contract.BankStatementModel['file'], Contract.FileReference | null>,
            true satisfies Equals<Json<Omit<Zibri.BankStatementImport, 'statements'>>, Json<Omit<Contract.BankStatementImportModel, 'statements'>>>,
            true satisfies Equals<Json<Zibri.BankTransaction>, Json<Contract.BankTransactionModel>>,
            true satisfies Equals<Json<Zibri.BankTransactionDetails>, Json<Contract.BankTransactionDetailsModel>>,
            // the query of GET /transactions is the page beside the filter of findTransactionDetails
            true satisfies Equals<Zibri.BankTransactionFilter, Omit<Contract.BankTransactionQueryModel, 'page' | 'limit'>>,
            true satisfies Equals<Json<Zibri.BankTransactionSuggestion>, Json<Contract.BankTransactionSuggestionModel>>,
            // the input of the requests of bank.match, which a frontend reads from a request and sends to propose one
            true satisfies Equals<Json<Zibri.BankMatchInput>, Json<Contract.BankMatchInputModel>>,
            true satisfies Equals<Json<Zibri.BankMatch>, Json<Contract.BankMatchModel>>
        ];
        expect(checks).not.toContain(false);
    });

    // a frontend lists the invoices and credit notes of a tenant, picks an open one to match a payment with, and shows
    // its pdf and electronic invoice
    it('read what the invoicing plugin answers, and send its query', () => {
        expect(Zibri.InvoiceType).toBe(Contract.InvoiceType);
        expect(Zibri.ZIBRI_INVOICING_PERMISSIONS).toBe(Contract.ZIBRI_INVOICING_PERMISSIONS);
        expect(Zibri.ZIBRI_INVOICING_PLATFORM_PERMISSIONS).toBe(Contract.ZIBRI_INVOICING_PLATFORM_PERMISSIONS);
        expect(Zibri.ZibriInvoicingPermissions).toBe(Contract.ZibriInvoicingPermissions);
        expect(Zibri.ZibriInvoicingPlatformPermissions).toBe(Contract.ZibriInvoicingPlatformPermissions);

        const checks: true[] = [
            // zibri holds a currency as one of the codes of ISO 4217 and a VAT category as one of its codes or any
            // other, which the contract reads as the strings they are
            true satisfies Equals<Json<Omit<Zibri.Invoice, 'currency' | 'items'>>, Json<Omit<Contract.InvoiceModel, 'currency' | 'items'>>>,
            true satisfies Equals<Contract.InvoiceModel['currency'], string>,
            true satisfies Equals<Json<Omit<Zibri.InvoiceItem, 'vat'>>, Json<Omit<Contract.InvoiceItemModel, 'vat'>>>,
            true satisfies Equals<Json<Omit<Zibri.Vat, 'categoryCode'>>, Json<Omit<Contract.VatModel, 'categoryCode'>>>,
            true satisfies Equals<Contract.VatModel['categoryCode'], string>,
            true satisfies Equals<Json<Zibri.AmountUnit>, Json<Contract.AmountUnitModel>>,
            true satisfies Equals<Json<Zibri.InvoiceAddress>, Json<Contract.InvoiceAddressModel>>,
            true satisfies Equals<Json<Zibri.ElectronicAddress>, Json<Contract.ElectronicAddressModel>>,
            true satisfies Equals<Json<Zibri.InvoiceReference>, Json<Contract.InvoiceReferenceModel>>,
            // the query of GET /invoices is the page and the tenant beside the filter of findInvoices
            true satisfies Equals<Zibri.InvoiceFilter, Omit<Contract.InvoiceQueryModel, 'page' | 'limit' | 'tenantId'>>
        ];
        expect(checks).not.toContain(false);
    });

    // a frontend starts the books of a tenant with their settings, accounts, fiscal years and posting rules, posts and
    // reverses entries, lists the journal, closes a year, checks the books, and enters and records expenses
    it('send what the bookkeeping plugin takes, and read what it answers', () => {
        expect(Zibri.ZIBRI_BOOKKEEPING_PERMISSIONS).toBe(Contract.ZIBRI_BOOKKEEPING_PERMISSIONS);
        expect(Zibri.ZIBRI_BOOKKEEPING_PLATFORM_PERMISSIONS).toBe(Contract.ZIBRI_BOOKKEEPING_PLATFORM_PERMISSIONS);
        expect(Zibri.ZibriBookkeepingPermissions).toBe(Contract.ZibriBookkeepingPermissions);
        expect(Zibri.ZibriBookkeepingPlatformPermissions).toBe(Contract.ZibriBookkeepingPlatformPermissions);
        expect(Zibri.BookkeepingAccountType).toBe(Contract.BookkeepingAccountType);
        expect(Zibri.JournalEntryLineRole).toBe(Contract.JournalEntryLineRole);

        const checks: true[] = [
            // zibri holds a currency as one of the codes of ISO 4217, which the contract reads as the string it is
            true satisfies Equals<Json<Omit<Zibri.BookkeepingSettings, 'currency'>>, Json<Omit<Contract.BookkeepingSettingsModel, 'currency'>>>,
            true satisfies Equals<Json<Omit<Zibri.NewBookkeepingSettings, 'currency'>>, Json<Omit<Contract.NewBookkeepingSettingsModel, 'currency'>>>,
            true satisfies Equals<Json<Omit<Zibri.BookkeepingSettingsChange, 'currency'>>, Json<Omit<Contract.BookkeepingSettingsChangeModel, 'currency'>>>,
            true satisfies Equals<Contract.BookkeepingSettingsModel['currency'] | Contract.NewBookkeepingSettingsModel['currency'], string>,
            true satisfies Equals<Json<Zibri.PostingRules>, Json<Contract.PostingRulesModel>>,
            true satisfies Equals<Json<Zibri.PostingRuleSet>, Json<Contract.PostingRuleSetModel>>,
            true satisfies Equals<Json<Zibri.NewPostingRuleSet>, Json<Contract.NewPostingRuleSetModel>>,
            true satisfies Equals<Json<Zibri.ExpenseSupplier>, Json<Contract.ExpenseSupplierModel>>,
            true satisfies Equals<Json<Zibri.ExpenseTaxTotal>, Json<Contract.ExpenseTaxTotalModel>>,
            true satisfies Equals<Json<Omit<Zibri.ExpenseData, 'currency'>>, Json<Omit<Contract.ExpenseDataModel, 'currency'>>>,
            true satisfies Equals<Json<Omit<Zibri.Expense, 'currency'>>, Json<Omit<Contract.ExpenseModel, 'currency'>>>,
            true satisfies Equals<Contract.ExpenseModel['currency'] | Contract.ExpenseDataModel['currency'], string>,
            // a file kept in a file store is answered as its FileReference, in place of the id the row holds
            true satisfies Equals<Json<Omit<Zibri.ExpenseReceipt, 'file'>>, Json<Omit<Contract.ExpenseReceiptModel, 'file'>>>,
            true satisfies Equals<Contract.ExpenseReceiptModel['file'], Contract.FileReference | null>,
            true satisfies Equals<Json<Zibri.AccountMatchRule>, Json<Contract.AccountMatchRuleModel>>,
            true satisfies Equals<Json<Zibri.NewAccountMatchRule>, Json<Contract.NewAccountMatchRuleModel>>,
            true satisfies Equals<Json<Zibri.BookkeepingLegalForm>, Json<Contract.BookkeepingLegalFormModel>>,
            true satisfies Equals<Json<Zibri.BookkeepingAccount>, Json<Contract.BookkeepingAccountModel>>,
            true satisfies Equals<Json<Zibri.NewBookkeepingAccount>, Json<Contract.NewBookkeepingAccountModel>>,
            true satisfies Equals<Json<Zibri.FiscalYear>, Json<Contract.FiscalYearModel>>,
            true satisfies Equals<Json<Zibri.NewFiscalYear>, Json<Contract.NewFiscalYearModel>>,
            true satisfies Equals<Json<Zibri.FiscalYearClosing>, Json<Contract.FiscalYearClosingModel>>,
            true satisfies Equals<Json<Zibri.FiscalYearClosingResult>, Json<Contract.FiscalYearClosingResultModel>>,
            true satisfies Equals<Json<Zibri.FiscalYearReopening>, Json<Contract.FiscalYearReopeningModel>>,
            true satisfies Equals<Json<Zibri.FiscalYearReopeningResult>, Json<Contract.FiscalYearReopeningResultModel>>,
            true satisfies Equals<Json<Zibri.JournalEntry>, Json<Contract.JournalEntryModel>>,
            true satisfies Equals<Json<Zibri.JournalEntryLine>, Json<Contract.JournalEntryLineModel>>,
            true satisfies Equals<Json<Zibri.JournalEntryDetails>, Json<Contract.JournalEntryDetailsModel>>,
            // the query of GET /entries is the page and the tenant beside the filter of findEntries
            true satisfies Equals<Zibri.JournalEntryFilter, Omit<Contract.JournalEntryQueryModel, 'page' | 'limit' | 'tenantId'>>,
            // the query of GET /expenses is the page and the tenant beside the filter of findExpenses
            true satisfies Equals<Zibri.ExpenseFilter, Omit<Contract.ExpenseQueryModel, 'page' | 'limit' | 'tenantId'>>,
            // a page of the entries with what every matching entry adds up to
            true satisfies Equals<Json<Zibri.JournalEntryPage>, Json<Contract.JournalEntryPageModel>>,
            // the query of GET /accounts is the tenant beside the filter of findAccounts
            true satisfies Equals<Zibri.BookkeepingAccountFilter, Omit<Contract.BookkeepingAccountQueryModel, 'tenantId'>>,
            true satisfies Equals<Json<Zibri.BookkeepingStatementFormChoices>, Json<Contract.BookkeepingStatementFormChoicesModel>>,
            true satisfies Equals<Json<Zibri.BookkeepingStatementFormChoice>, Json<Contract.BookkeepingStatementFormChoiceModel>>,
            true satisfies Equals<Json<Zibri.BookkeepingStatementForm>, Json<Contract.BookkeepingStatementFormModel>>,
            true satisfies Equals<Json<Zibri.NewJournalEntry>, Json<Contract.NewJournalEntryModel>>,
            true satisfies Equals<Json<Zibri.NewJournalEntryLine>, Json<Contract.NewJournalEntryLineModel>>,
            true satisfies Equals<Json<Zibri.JournalEntryReversal>, Json<Contract.JournalEntryReversalModel>>,
            true satisfies Equals<Json<Zibri.BookkeepingClosingProposal>, Json<Contract.BookkeepingClosingProposalModel>>,
            true satisfies Equals<Json<Zibri.BookkeepingVerification>, Json<Contract.BookkeepingVerificationModel>>,
            true satisfies Equals<Json<Zibri.BookkeepingVerificationProblem>, Json<Contract.BookkeepingVerificationProblemModel>>
        ];
        expect(checks).not.toContain(false);
    });

    // a frontend previews and prepares the E-Bilanz of a fiscal year, maps accounts to positions of their own and shows
    // whether the certificate is uploaded
    it('send what the E-Bilanz plugin takes, and read what it answers', () => {
        expect(Zibri.EBilanzAccountingStandard).toBe(Contract.EBilanzAccountingStandard);
        expect(Zibri.EBilanzFilingKind).toBe(Contract.EBilanzFilingKind);
        expect(Zibri.EBilanzTransmissionStatus).toBe(Contract.EBilanzTransmissionStatus);
        expect(Zibri.EBilanzRevisionStatus).toBe(Contract.EBilanzRevisionStatus);

        const checks: true[] = [
            true satisfies Equals<Json<Zibri.EBilanzPreparationInput>, Json<Contract.EBilanzPreparationInputModel>>,
            // the content is an E-Bilanz of its own, whose income statement form zibri holds as its enum and the
            // contract reads as the string it is
            true satisfies Equals<Json<Omit<Zibri.EBilanzPreparation, 'content'>>, Json<Omit<Contract.EBilanzPreviewModel, 'content'>>>,
            true satisfies Equals<Json<Zibri.EBilanzSettingsView>, Json<Contract.EBilanzCertificateSettingsModel>>,
            true satisfies Equals<Json<Zibri.EBilanzAccountMapping>, Json<Contract.EBilanzAccountMappingModel>>,
            true satisfies Equals<Json<Zibri.EBilanzAccountMappingInput>, Json<Contract.EBilanzAccountMappingChangeModel>>,
            // a record answers its protocol as its FileReference, in place of the id it holds, and its content as below
            true satisfies Equals<Json<Omit<Zibri.EBilanzFiling, 'protocol' | 'content'>>, Json<Omit<Contract.EBilanzFilingModel, 'protocol' | 'content'>>>,
            true satisfies Equals<Contract.EBilanzFilingModel['protocol'], Contract.FileReference | null>,
            true satisfies Equals<Json<Zibri.EBilanzTransmissionFailure>, Json<Contract.EBilanzTransmissionFailureModel>>,
            // a transmission answers the record of its result as a record, checked above
            true satisfies Equals<Json<Omit<Zibri.EBilanzTransmissionSummary, 'result'>>, Json<Omit<Contract.EBilanzTransmissionModel, 'result'>>>,
            true satisfies Equals<Contract.EBilanzTransmissionModel['result'], Contract.EBilanzFilingModel | null>,
            true satisfies Equals<Json<Omit<Zibri.EBilanzState, 'content' | 'filings' | 'transmissions'>>, Json<Omit<Contract.EBilanzStateModel, 'content' | 'filings' | 'transmissions'>>>,
            true satisfies Equals<Contract.EBilanzStateModel['transmissions'], Contract.EBilanzTransmissionModel[]>,
            // zibri holds the form of the income statement and the statement and requirement of a position as the names
            // it knows, which the contract reads as the strings they are
            true satisfies Equals<Json<Omit<Zibri.EBilanzContent, 'incomeStatementForm' | 'positions'>>, Json<Omit<Contract.EBilanzContentModel, 'incomeStatementForm' | 'positions'>>>,
            true satisfies Equals<Json<Omit<Zibri.EBilanzPosition, 'statement' | 'requirement'>>, Json<Omit<Contract.EBilanzPositionModel, 'statement' | 'requirement'>>>,
            true satisfies Equals<Contract.EBilanzContentModel['incomeStatementForm'] | Contract.EBilanzPositionModel['statement'] | Contract.EBilanzPositionModel['requirement'], string>,
            true satisfies Equals<Json<Zibri.EBilanzFixedAsset>, Json<Contract.EBilanzFixedAssetModel>>,
            true satisfies Equals<Json<Zibri.EBilanzField>, Json<Contract.EBilanzFieldModel>>,
            true satisfies Equals<Json<Zibri.EBilanzFinding>, Json<Contract.EBilanzFindingModel>>,
            true satisfies Equals<Json<Zibri.EBilanzExporterInfo>, Json<Contract.EBilanzExporterModel>>,
            true satisfies Equals<Json<Zibri.GermanBookkeepingCompany>, Json<Contract.GermanBookkeepingCompanyModel>>
        ];
        expect(checks).not.toContain(false);
    });

    it('read the change sets of zibri, without the relation back from a change to its change set', () => {
        const checks: true[] = [
            true satisfies Equals<Json<Omit<Zibri.Change, 'changeSet'>>, Json<Contract.Change>>,
            true satisfies Equals<Json<Omit<Zibri.ChangeSet, 'changes'>>, Json<Omit<Contract.ChangeSet, 'changes'>>>,
            true satisfies Equals<Json<Omit<Zibri.ChangeSetEntity, 'changeSets'>>, Json<Omit<Contract.ChangeSetEntity, 'changeSets'>>>,
            true satisfies Equals<Json<Omit<Zibri.SoftDeleteEntity, 'changeSets'>>, Json<Omit<Contract.SoftDeleteEntity, 'changeSets'>>>,
            // zibri resets nested values too, which a frontend reads as the properties they are in
            true satisfies Equals<keyof Zibri.ResetChangeSetResult<Zibri.ChangeSetEntity>, keyof Contract.ResetChangeSetResult>
        ];
        expect(checks).not.toContain(false);
    });

    // a frontend lists the approval requests of a tenant, shows what one would change, and approves or rejects it
    it('send what the approval plugin takes, and read what it answers', () => {
        expect(Zibri.ApprovalRequestStatus).toBe(Contract.ApprovalRequestStatus);
        expect(Zibri.ApprovalDecisionType).toBe(Contract.ApprovalDecisionType);
        expect(Zibri.ApprovalActorKind).toBe(Contract.ApprovalActorKind);
        expect(Zibri.ZIBRI_APPROVAL_PERMISSIONS).toBe(Contract.ZIBRI_APPROVAL_PERMISSIONS);
        expect(Zibri.ZibriApprovalPermissions).toBe(Contract.ZibriApprovalPermissions);

        const checks: true[] = [
            true satisfies Equals<Json<Zibri.ApprovalRequest>, Json<Contract.ApprovalRequestModel>>,
            true satisfies Equals<Json<Zibri.ApprovalDecision>, Json<Contract.ApprovalDecisionModel>>,
            true satisfies Equals<Json<Zibri.ApprovalRequestDetails>, Json<Contract.ApprovalRequestDetailsModel>>,
            true satisfies Equals<Json<Zibri.ApprovalRequestChange>, Json<Contract.ApprovalRequestChangeModel>>,
            true satisfies Equals<Json<Zibri.ApprovalValueChange>, Json<Contract.ApprovalValueChangeModel>>,
            true satisfies Equals<Json<Zibri.ApprovalPrecondition>, Json<Contract.ApprovalPreconditionModel>>,
            true satisfies Equals<Json<Zibri.NewApprovalRequest>, Json<Contract.NewApprovalRequestModel>>,
            true satisfies Equals<Json<Zibri.ApprovalDecisionInput>, Json<Contract.ApprovalDecisionInputModel>>
        ];
        expect(checks).not.toContain(false);
    });

    // a frontend lists the projects and tasks a user sees, shows and changes a board live, comments on its tasks and
    // shares a project with a customer
    it('send what the projects plugin takes, and read what it answers', () => {
        expect(Zibri.ZIBRI_PROJECTS_PERMISSIONS).toBe(Contract.ZIBRI_PROJECTS_PERMISSIONS);
        expect(Zibri.ZIBRI_PROJECTS_PLATFORM_PERMISSIONS).toBe(Contract.ZIBRI_PROJECTS_PLATFORM_PERMISSIONS);
        expect(Zibri.ZibriProjectsPermissions).toBe(Contract.ZibriProjectsPermissions);
        expect(Zibri.ZibriProjectsPlatformPermissions).toBe(Contract.ZibriProjectsPlatformPermissions);
        expect(Zibri.ZIBRI_PROJECTS_LIMITS).toBe(Contract.ZIBRI_PROJECTS_LIMITS);
        expect(Zibri.PROJECT_ROLES).toBe(Contract.PROJECT_ROLES);
        expect(Zibri.PROJECT_BOARD_WEBSOCKET_EVENT).toBe(Contract.PROJECT_BOARD_WEBSOCKET_EVENT);
        expect(Zibri.NON_WORKING_DAY_RULES).toBe(Contract.NON_WORKING_DAY_RULES);
        expect(Zibri.RECURRENCE_UNITS).toBe(Contract.RECURRENCE_UNITS);

        const checks: true[] = [
            // the relations of the entities are answered by none of the routes
            true satisfies Equals<Json<Omit<Zibri.Project, 'parent' | 'children' | 'columns' | 'tasks' | 'labels' | 'recurringTasks'>>, Json<Contract.ProjectModel>>,
            true satisfies Equals<Json<Omit<Zibri.ProjectColumn, 'project' | 'tasks'>>, Json<Contract.ProjectColumnModel>>,
            // the change sets of a task are answered with their changes by GET /tasks/:taskId alone
            true satisfies Equals<Json<Omit<Zibri.Task, 'project' | 'column' | 'comments' | 'changeSets'>>, Json<Omit<Contract.TaskModel, 'changeSets'>>>,
            true satisfies Equals<Json<Omit<Zibri.TaskLabel, 'project'>>, Json<Contract.TaskLabelModel>>,
            true satisfies Equals<Json<Omit<Zibri.TaskComment, 'task'>>, Json<Contract.TaskCommentModel>>,
            true satisfies Equals<Json<Zibri.NewProject>, Json<Contract.NewProjectModel>>,
            true satisfies Equals<Json<Zibri.ProjectChange>, Json<Contract.ProjectChangeModel>>,
            true satisfies Equals<Json<Zibri.NewProjectColumn>, Json<Contract.NewProjectColumnModel>>,
            true satisfies Equals<Json<Zibri.ProjectColumnChange>, Json<Contract.ProjectColumnChangeModel>>,
            true satisfies Equals<Json<Zibri.ProjectColumnMove>, Json<Contract.ProjectColumnMoveModel>>,
            true satisfies Equals<Json<Zibri.NewTask>, Json<Contract.NewTaskModel>>,
            true satisfies Equals<Json<Zibri.TaskChange>, Json<Contract.TaskChangeModel>>,
            true satisfies Equals<Json<Zibri.TaskMove>, Json<Contract.TaskMoveModel>>,
            true satisfies Equals<Json<Zibri.NewTaskLabel>, Json<Contract.NewTaskLabelModel>>,
            true satisfies Equals<Json<Zibri.TaskLabelChange>, Json<Contract.TaskLabelChangeModel>>,
            true satisfies Equals<Json<Zibri.NewTaskComment>, Json<Contract.NewTaskCommentModel>>,
            true satisfies Equals<Json<Zibri.ProjectUser>, Json<Contract.ProjectUserModel>>,
            // a user without the email is the user a guest is shown
            true satisfies Equals<Omit<Contract.ProjectUserModel, 'email'>, Contract.SharedUserModel>,
            // the rows of the board and of the page are checked above
            true satisfies Equals<Json<Omit<Zibri.ProjectBoard, 'project' | 'columns' | 'labels' | 'tasks'>>, Json<Omit<Contract.ProjectBoardModel, 'project' | 'columns' | 'labels' | 'tasks'>>>,
            true satisfies Equals<Json<Zibri.ProjectCallerAccess>, Json<Contract.ProjectCallerAccessModel>>,
            true satisfies Equals<Json<Zibri.ProjectWithAccess>, Json<Contract.ProjectWithAccessModel>>,
            true satisfies Equals<Json<Omit<Zibri.TaskCommentPage, 'items'>>, Json<Omit<Contract.TaskCommentPageModel, 'items'>>>,
            true satisfies Equals<Json<Zibri.ProjectShare>, Json<Contract.ProjectShareModel>>,
            true satisfies Equals<Json<Zibri.NewProjectShare>, Json<Contract.NewProjectShareModel>>,
            true satisfies Equals<Json<Zibri.ProjectShareRole>, Json<Contract.ProjectShareRoleModel>>,
            true satisfies Equals<Json<Zibri.ProjectShareResult>, Json<Contract.ProjectShareResultModel>>,
            true satisfies Equals<Json<Zibri.ProjectBoardSubscription>, Json<Contract.ProjectBoardSubscriptionModel>>,
            true satisfies Equals<Json<Zibri.ProjectBoardMessage>, Json<Contract.ProjectBoardMessageModel>>,
            // the queries of GET / and GET /tasks are the page beside the filters of findProjects and findTasks
            true satisfies Equals<Zibri.ProjectFilter, Omit<Contract.ProjectQueryModel, 'page' | 'limit'>>,
            true satisfies Equals<Zibri.TaskFilter, Omit<Contract.TaskQueryModel, 'page' | 'limit'>>,
            // recurring tasks and the working calendar, the occurrences of a recurring task kept by zibri alone
            true satisfies Equals<Json<Zibri.TaskRecurrence>, Json<Contract.TaskRecurrenceModel>>,
            // zibri holds a time zone as one of the zones it knows, which the contract reads as the string it is
            true satisfies Equals<Json<Omit<Zibri.RecurringTask, 'project' | 'occurrences' | 'timezone'>>, Json<Omit<Contract.RecurringTaskModel, 'timezone'>>>,
            true satisfies Equals<Json<Omit<Zibri.NewRecurringTask, 'timezone'>>, Json<Omit<Contract.NewRecurringTaskModel, 'timezone'>>>,
            true satisfies Equals<Json<Omit<Zibri.RecurringTaskChange, 'timezone'>>, Json<Omit<Contract.RecurringTaskChangeModel, 'timezone'>>>,
            true satisfies Equals<Contract.RecurringTaskModel['timezone'] | Contract.NewRecurringTaskModel['timezone'], string>,
            true satisfies Equals<Json<Zibri.WorkingCalendar>, Json<Contract.WorkingCalendarModel>>,
            true satisfies Equals<Json<Zibri.WorkingCalendarChange>, Json<Contract.WorkingCalendarChangeModel>>,
            true satisfies Equals<Json<Zibri.ProjectCalendar>, Json<Contract.ProjectCalendarModel>>,
            true satisfies Equals<Json<Zibri.ProjectCalendarSync>, Json<Contract.ProjectCalendarSyncModel>>,
            true satisfies Equals<Json<Zibri.ProjectCalendarSyncTarget>, Json<Contract.ProjectCalendarSyncTargetModel>>
        ];
        expect(checks).not.toContain(false);
    });
});