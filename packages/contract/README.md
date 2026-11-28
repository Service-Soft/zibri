# Zibri Contract

The models a frontend shares with a [Zibri](https://github.com/Service-Soft/zibri) backend: the filter and the order of
a list, a page, the error body, what the auth routes answer and take, logs, change sets, the analytics, the bank, the
invoices, the bookkeeping, the approval requests, the projects, the WebDAV connections of a tenant, its file mirror and its backup transports. Each is the model as it arrives as json, so a date is the ISO
string it is sent as. Types and the enums they hold, `LogLevel`, `ChangeSetType`, `AnalyticsOperatingSystem`,
`BankMatchTargetType`, `BankMatchReason`, `BankTransactionStatus`, `InvoiceType`, `BookkeepingAccountType`,
`ApprovalRequestStatus`, `ApprovalDecisionType`, `ApprovalActorKind`, `MirroredFileConflict` and
`MirroredFileConflictResolution`, so it runs in a browser and a bundler leaves out what a page doesn't use.

```bash
npm i zibri-contract
```

zibri declares its own models against these: its enums are the ones of this package, and a check fails its build when
one of its models no longer arrives as the model here says.

## Filtering and ordering a list

A config declared once types both sides: the backend hands it to its `CrudController`, and the frontend builds the
query from it.

```ts
// src/task-list.config.ts, in a file the backend and the frontend share
import { FilterConfig, FilterValue, OrderConfig, OrderValue } from 'zibri-contract';

export type Task = {
    title: string,
    status: string,
    dueAt: Date,
    project: { name: string }
};

// eslint-disable-next-line typescript/typedef
export const taskFilter = { title: 'iLike', status: 'oneOf', dueAt: 'range', project: { name: 'equals' } } as const satisfies FilterConfig<Task>;

// eslint-disable-next-line typescript/typedef
export const taskOrder = { dueAt: true, title: true } as const satisfies OrderConfig<Task>;

export type TaskFilter = FilterValue<Task, typeof taskFilter>;

export type TaskOrder = OrderValue<Task, typeof taskOrder>;
```

`as const satisfies` keeps each match, so `TaskFilter` takes a text for `title`, a list for `status` and
`{ from, to }` for `dueAt`, and `TaskOrder` only the properties of `taskOrder`.

| Type | What it is |
|---|---|
| `FilterConfig` | How each property of a model filters a list: a match, or the config of the properties inside |
| `FilterValue`, `FilterRange` | The filter a list takes for a config, and the `from` and `to` of a range in it |
| `FilterMatch` | `StringFilterMatch`, `RangeFilterMatch`, `BooleanFilterMatch` or `ArrayFilterMatch`, by the type of the property |
| `OrderConfig` | The properties a list may be ordered by: `true`, or the config of the properties inside |
| `OrderValue`, `OrderDirection` | The order a list takes for a config, `'ASC'` or `'DESC'` by property |
| `PaginationResult` | A page of a list: its `items` and the `totalAmount` of all pages |

## The other models

| Models | What they are |
|---|---|
| `ErrorResponseBody`, `ValidationProblem` | What a refused or failed request is answered with, and the problems of the values it refused |
| `LocaleCode` | A locale, such as `de` or `en-US`, like the one a user reads the mails of the application in |
| `FileReference` | A file of an entity your backend keeps in a file store, like a receipt or an attachment: its name, mime type and size, and the url a browser downloads it from |
| `StoredFile` | Deprecated, use `FileReference`. A file your backend stored, with an id and the url a browser loads it from. Removed in zibri 4 |
| `SecondFactorRequiredErrorBody`, `PasswordChangeRequiredErrorBody` | The error body of a login that waits for a second factor or a new password, with its ticket |
| `JwtAuthData`, `Jwt`, `CookieAuthData`, `CsrfToken`, `LogoutResult` | What a login, a refresh and a logout answer |
| `LoginMethods`, `RequestLoginLinkInput`, `LoginLinkCredentials` | Which ways of logging in the backend takes, and what asking for a link sent by email and logging in with it take |
| `CurrentUserProfile`, `CurrentUserMembership`, `UserLogin`, `LinkedIdentity` | The logged in user, their tenants, where they are logged in and the identities linked to them |
| `UserKind` | Whether a user is a person or a service account |
| `ServiceAccountModel`, `ServiceAccountApiKeyModel`, `NewServiceAccountModel`, `ServiceAccountRolesModel` | A service account with its roles and its API keys, without their secrets, and what creating one and changing its roles take |
| `NewServiceAccountApiKeyModel`, `CreatedServiceAccountApiKeyModel`, `ZIBRI_SERVICE_ACCOUNT_LIMITS` | What creating an API key of a service account takes and answers, with the key itself, and the longest values the routes take |
| `McpToolSummaryModel` | A tool of the MCP server, as the tools a service account can use are listed |
| `ZIBRI_SERVICE_ACCOUNT_PLATFORM_PERMISSIONS`, `ZibriServiceAccountPlatformPermissions` | The platform permissions of listing and of managing the service accounts, to spread into those of the application |
| `RowShareModel`, `PendingRowShareModel`, `SharedUserModel` | A row shared with a user in a role, a row an invitation shares once it is accepted, and another user as somebody who sees only what is shared with them reads them |
| `TwoFactorRegistrations`, `OtpRegistration`, `OtpRegistrationConfirmData`, `RecoveryCodeRegistration`, `CodeRegistrationConfirmData`, `SmsRegistrationRequestData` | The enrollment of a second factor |
| `EmailConfirmation`, `PasswordResetTokenValidity`, `FederatedLinkIdentityStart`, `PasskeyTicketCredentials` | What following the link of an email, checking a password reset, linking a provider and creating a passkey answer |
| `Log`, `LogLevel`, `LogContext`, `LoggedError`, `LogRequestContext`, `LogCollapsedContext`, `CacheContext` | A log and where it comes from |
| `ChangeSet`, `ChangeSetType`, `Change`, `ChangeSetEntity`, `SoftDeleteEntity`, `ResetChangeSetResult` | The change sets of an entity, and what resetting one answers |
| `AnalyticsPageViewModel`, `AnalyticsEventModel`, `AnalyticsSourceModel` | What a page sends the analytics plugin: a page view, an event, and the source of the visit in them |
| `AnalyticsDayModel`, `AnalyticsPageModel`, `AnalyticsSourceCountModel`, `AnalyticsSystemModel`, `AnalyticsOperatingSystem` | What the counts of the analytics plugin answer per day, page, source and operating system |
| `AnalyticsFunnelModel`, `AnalyticsFunnelStepModel`, `AnalyticsFunnelSourceModel`, `AnalyticsFunnelBy` | A funnel of the analytics plugin, the steps it takes and its counts per source |
| `AnalyticsSiteModel`, `AnalyticsSiteVerificationRecordModel`, `NewAnalyticsSiteModel` | A site the analytics plugin counts, of a tenant or of none, the DNS record that verifies it, and what adding one takes |
| `ZIBRI_ANALYTICS_PERMISSIONS`, `ZibriAnalyticsPermissions` | The tenant permissions of the sites and counts of a tenant, to spread into those of the application |
| `ZIBRI_ANALYTICS_PLATFORM_PERMISSIONS`, `ZibriAnalyticsPlatformPermissions` | The platform permissions of every site and its counts, to spread into those of the application |
| `BankAccountModel`, `NewBankAccountModel` | A bank account of a tenant the bank plugin imports statements into, and what adding one takes |
| `BankStatementModel`, `BankStatementImportModel`, `ArchivedFileModel` | A statement imported from a CAMT.053 file, what an import answers, and the original file as the archive recorded it |
| `BankTransactionModel` | A booked transaction of a bank account |
| `BankTransactionDetailsModel`, `BankTransactionQueryModel`, `BankTransactionStatus` | A transaction with what of it is left to match, a page of them narrowed by account, statement, days and status, as the query of their route, and whether one is open or matched in full |
| `BankTransactionSuggestionModel`, `BankMatchInputModel`, `BankMatchReason` | A pending suggestion of a transaction, with the request it is decided by, what a request of `bank.match` runs with, and why a match was suggested |
| `BankMatchModel`, `BankMatchTargetType` | A confirmed match of a transaction with what it pays or is booked against, and what it is matched with |
| `ZIBRI_BANK_PERMISSIONS`, `ZibriBankPermissions` | The tenant permissions of the bank accounts, statements, transactions and matches, to spread into those of the application |
| `InvoiceModel`, `InvoiceType`, `InvoiceItemModel`, `InvoiceAddressModel`, `ElectronicAddressModel`, `AmountUnitModel`, `VatModel`, `InvoiceReferenceModel` | An invoice or credit note, whether it is one or the other, its items, the address it goes to and the invoices it references |
| `InvoiceQueryModel` | A page of the invoices narrowed by a search, whether they are issued, their type and whether they are open, as the query of their route |
| `ZIBRI_INVOICING_PERMISSIONS`, `ZibriInvoicingPermissions` | The tenant permission of reading the invoices of a tenant, to spread into those of the application |
| `ZIBRI_INVOICING_PLATFORM_PERMISSIONS`, `ZibriInvoicingPlatformPermissions` | The platform permission of reading the invoices of every tenant, to spread into those of the application |
| `BookkeepingSettingsModel`, `NewBookkeepingSettingsModel`, `BookkeepingSettingsChangeModel`, `BookkeepingLegalFormModel`, `BookkeepingCompanyModel` | The settings of the books of a tenant, what starting and changing them takes, its legal form from a day on, and the company whose books they are |
| `BookkeepingAccountModel`, `NewBookkeepingAccountModel`, `BookkeepingAccountType` | An account of the books of a tenant, what adding one takes, and what it holds |
| `FiscalYearModel`, `NewFiscalYearModel`, `FiscalYearChangeModel`, `FiscalYearClosingModel`, `FiscalYearClosingResultModel` | A fiscal year of the books, what adding, changing and closing one takes, and what closing it posted |
| `BookkeepingStatementModel`, `BookkeepingStatementPositionModel`, `BookkeepingStatementType`, `BookkeepingAccountAmountModel` | The balance sheet or the income statement of a fiscal year in one form, a position of it, what it states, and what one account adds to a report |
| `BookkeepingStatementFormChoicesModel`, `BookkeepingStatementFormChoiceModel`, `BookkeepingStatementFormModel` | The forms the balance sheet and the income statement of a fiscal year can be shown in, the one that applies to each, and a form with its name |
| `BookkeepingJournalReportModel`, `BookkeepingLedgerReportModel`, `BookkeepingLedgerLineModel` | The journal of a range, and the ledger of an account with its lines |
| `BookkeepingTrialBalanceModel`, `BookkeepingTrialBalanceRowModel`, `BookkeepingRevenueReportModel` | The trial balance of a fiscal year with a row per account, and the revenue of a calendar year |
| `BookkeepingExportOptionsModel` | Whether the export of a fiscal year for a tax audit holds its documents, as the query of its route |
| `PostingRuleSetModel`, `NewPostingRuleSetModel`, `PostingRulesModel`, `PostingRuleRevenueAccountModel`, `PostingRuleTaxAccountModel`, `PostingRuleBankAccountModel` | The posting rules of a fiscal year from a day on, what adding a rule set takes, and its rules |
| `ExpenseModel`, `ExpenseDataModel`, `ExpenseSupplierModel`, `ExpenseTaxTotalModel`, `ExpenseReceiptModel` | An expense, what entering one takes, who issued it, its amounts of one VAT rate, and its archived receipt |
| `ExpenseQueryModel` | A page of the expenses narrowed by a search, as the query of their route |
| `AccountMatchRuleModel`, `NewAccountMatchRuleModel` | A rule suggesting the account a bank transaction is matched with, and what adding one takes |
| `JournalEntryModel`, `JournalEntryLineModel`, `JournalEntryDetailsModel` | A posted journal entry, a line of it, and the entry with its lines |
| `JournalEntryQueryModel`, `JournalEntryPageModel` | A page of the entries narrowed by fiscal year, days and account, as the query of their route, and the page it answers, with the totals of every entry matching |
| `BookkeepingAccountQueryModel` | The accounts of the books narrowed by a search and whether they are open, as the query of their route |
| `NewJournalEntryModel`, `NewJournalEntryLineModel`, `JournalEntryReversalModel` | What posting an entry takes, and what reversing one takes |
| `BookkeepingClosingProposalModel` | An entry a conformance proposes to post before a fiscal year is closed |
| `BookkeepingVerificationModel`, `BookkeepingVerificationProblemModel` | What checking the books of a tenant found |
| `ZIBRI_BOOKKEEPING_PERMISSIONS`, `ZibriBookkeepingPermissions` | The tenant permissions of the books of a tenant, to spread into those of the application |
| `ZIBRI_BOOKKEEPING_PLATFORM_PERMISSIONS`, `ZibriBookkeepingPlatformPermissions` | The platform permissions of the books of every tenant, to spread into those of the application |
| `ApprovalRequestModel`, `ApprovalRequestStatus`, `ApprovalActorKind` | An action proposed for approval, where it stands, and whether a user, the system or a policy proposed or decided it |
| `ApprovalDecisionModel`, `ApprovalDecisionType`, `ApprovalRequestDetailsModel` | The decision on a request, with the result or error of its action, and a request together with its decision |
| `ApprovalRequestChangeModel`, `ApprovalValueChangeModel`, `ApprovalPreconditionModel` | The rows a request would write and the values it would change, for the reviewer, and the rows it was proposed against |
| `NewApprovalRequestModel`, `ApprovalDecisionInputModel` | What proposing an action takes, and what approving or rejecting one takes |
| `ZIBRI_APPROVAL_PERMISSIONS`, `ZibriApprovalPermissions` | The tenant permissions of reading and deciding approval requests, to spread into those of the application |
| `ProjectModel`, `NewProjectModel`, `ProjectChangeModel`, `ProjectQueryModel` | A project of a tenant, what creating and changing one take, and the query of the list of projects |
| `ProjectColumnModel`, `NewProjectColumnModel`, `ProjectColumnChangeModel`, `ProjectColumnMoveModel` | A column of the board of a project, and what adding, changing and moving one take |
| `TaskModel`, `NewTaskModel`, `TaskChangeModel`, `TaskMoveModel`, `TaskQueryModel` | A task, what creating, changing and moving one take, and the query of the list of tasks |
| `TaskLabelModel`, `NewTaskLabelModel`, `TaskLabelChangeModel` | A label of a project, and what adding and changing one take |
| `TaskCommentModel`, `NewTaskCommentModel`, `TaskCommentPageModel` | A comment on a task, what writing one takes, and a page of them with their authors |
| `ProjectBoardModel`, `ProjectUserModel` | The board of a project, and a user as the routes show them, by name, and by email to a caller who sees every project |
| `ProjectCallerAccessModel`, `ProjectWithAccessModel` | What the caller may do on a project, their role and whether they see every project, as the board answers it, and a project with it, as `GET /projects/:projectId` answers it |
| `ProjectShareModel`, `NewProjectShareModel`, `ProjectShareRoleModel`, `ProjectShareResultModel` | A share of a project, what sharing by email and with a member take, and what sharing by email did |
| `ProjectBoardSubscriptionModel`, `ProjectBoardMessageModel`, `PROJECT_BOARD_WEBSOCKET_EVENT` | What subscribing to the live changes of a board takes, a change as it arrives, and the websocket event it arrives as |
| `PROJECT_ROLES`, `ProjectRole`, `ZIBRI_PROJECTS_LIMITS` | The roles a project is shared in, and the longest values the projects take |
| `RecurringTaskModel`, `NewRecurringTaskModel`, `RecurringTaskChangeModel`, `TaskRecurrenceModel`, `RECURRENCE_UNITS`, `RecurrenceUnit` | A recurring task of a project, what creating and changing one take, when it is due, and the units it recurs in |
| `WorkingCalendarModel`, `WorkingCalendarChangeModel`, `ProjectCalendarModel`, `NON_WORKING_DAY_RULES`, `NonWorkingDayRule` | The working calendar that applies to a project, a change of one, what a project or the tenant sets beside what applies, and what happens to a due date on a day that is not a working day |
| `ProjectCalendarSyncModel`, `ProjectCalendarSyncTargetModel` | Which calendar a project or the tenant writes the due dates of its tasks into, or none, and the calendar: a WebDAV connection of the tenant and the path of the calendar |
| `ZIBRI_PROJECTS_PERMISSIONS`, `ZibriProjectsPermissions` | The tenant permissions of the projects of a tenant, to spread into those of the application |
| `ZIBRI_PROJECTS_PLATFORM_PERMISSIONS`, `ZibriProjectsPlatformPermissions` | The platform permissions of the projects of every tenant, to spread into those of the application |
| `TenantWebDavConnectionModel`, `NewTenantWebDavConnectionModel`, `TenantWebDavConnectionChangeModel`, `ZIBRI_WEB_DAV_CONNECTION_LIMITS` | A connection of a tenant to a folder of a WebDAV server, without its password, what adding and changing one take, and the longest values they take |
| `ZIBRI_WEB_DAV_PERMISSIONS`, `ZibriWebDavPermissions` | The tenant permissions of listing and of managing the WebDAV connections of a tenant, to spread into those of the application |
| `MirroredFileModel`, `MirroredFileConflict`, `MirroredFileConflictResolution`, `MirroredFileConflictResolutionInputModel` | A file mirrored into a folder of a WebDAV server, why it was not written, and how its conflict is resolved |
| `FileMirrorShareLinkModel`, `FileMirrorShareLinkInputModel`, `ZIBRI_FILE_MIRROR_LIMITS` | A link a Nextcloud shares a mirrored file or folder by, what asking for one takes, and the longest values the routes of the file mirror take |
| `ZIBRI_FILE_MIRROR_PERMISSIONS`, `ZibriFileMirrorPermissions` | The tenant permissions of listing the conflicts of the file mirror, and of resolving them and managing share links, to spread into those of the application |
| `TenantBackupTransportModel`, `NewTenantBackupTransportModel`, `TenantBackupTransportChangeModel`, `TenantBackupTransportKindModel`, `ZIBRI_BACKUP_TRANSPORT_LIMITS` | Storage a tenant keeps its backups on, without its secret, what adding and changing one take, a kind the application lets tenants add, and the longest values the routes take |
| `ZIBRI_BACKUP_TRANSPORT_KINDS`, `TenantS3TransportSettingsModel`, `TenantS3TransportSecretModel`, `S3_ADDRESSING_STYLES`, `S3AddressingStyle` | The names of the kinds Zibri ships, and the settings and the secret of a bucket of an S3 compatible storage |
| `TenantSftpTransportSettingsModel`, `TenantSftpTransportSecretModel`, `TenantWebDavTransportSettingsModel`, `TenantNextcloudTransportSettingsModel` | The settings and the secret of an SFTP server, and the settings of a folder of a WebDAV server and of a Nextcloud, whose secret is `{}` |
| `ZIBRI_BACKUP_TRANSPORT_PERMISSIONS`, `ZibriBackupTransportPermissions` | The tenant permissions of listing and of managing the backup transports of a tenant, to spread into those of the application |

The full documentation is at
[service-soft.github.io/zibri](https://service-soft.github.io/zibri/endpoints/creating-endpoints/#filtering-and-ordering-a-list).