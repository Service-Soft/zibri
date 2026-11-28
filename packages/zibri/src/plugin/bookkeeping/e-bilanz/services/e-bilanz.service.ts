import { ArchiveUtilities } from '../../../../archive/archive.utilities';
import { AlsUtilities } from '../../../../context/als.utilities';
import { Repository } from '../../../../data-source/repository/repository';
import { type Transaction } from '../../../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../../di/default/zibri-di-tokens.default';
import { getDiTokenName } from '../../../../di/get-di-token-name.function';
import { getRegisteredProvidersOfVariant } from '../../../../di/get-registered-providers-of-variant.function';
import { inject } from '../../../../di/inject.function';
import { type DiVariant } from '../../../../di/models/di-variant.model';
import { ConflictError } from '../../../../error-handling/errors/conflict.error';
import { InternalError } from '../../../../error-handling/internal-error.model';
import { type FileRecord } from '../../../../file/file-record.model';
import { $ts } from '../../../../localization/translate.function';
import { type LeaseServiceInterface } from '../../../../leases/lease-service.interface';
import { errorToLoggedError } from '../../../../logging/error-to-logged-error.function';
import { type OmitStrict } from '../../../../types/omit-strict.type';
import { Ms } from '../../../../utilities/ms';
import { BigNumber, NumberUtilities } from '../../../../utilities/number.utilities';
import { BookkeepingDayUtilities } from '../../bookkeeping-day.utilities';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from '../../bookkeeping.tokens';
import { BookkeepingAccount } from '../../models/bookkeeping-account.model';
import { type BookkeepingAccountBalance } from '../../models/bookkeeping-account-balance.model';
import { type BookkeepingCarriedBalances } from '../../models/bookkeeping-carried-balances.model';
import { type BookkeepingSettings } from '../../models/bookkeeping-settings.model';
import { type BookkeepingStatementStructure } from '../../models/bookkeeping-statement-structure.model';
import { BookkeepingStatementType } from '../../models/bookkeeping-statement-type.enum';
import { type BookkeepingStatement } from '../../models/bookkeeping-statement.model';
import { type BookkeepingTrialBalance } from '../../models/bookkeeping-trial-balance.model';
import { FiscalYearEntrySourceType } from '../../models/fiscal-year-entry-source-type.enum';
import { FiscalYear } from '../../models/fiscal-year.model';
import { JournalEntryLineRole } from '../../models/journal-entry-line-role.enum';
import { JournalEntryLine } from '../../models/journal-entry-line.model';
import { JournalEntry } from '../../models/journal-entry.model';
import { type BookkeepingReportServiceInterface } from '../../services/bookkeeping-report-service.interface';
import { HGB_MICRO_INCOME_STATEMENT } from '../../statements/hgb-micro-income-statement.model';
import { EBilanzDeadlineUtilities } from '../e-bilanz-deadline.utilities';
import { EBilanzTaxonomyUtilities } from '../e-bilanz-taxonomy.utilities';
import { E_BILANZ_EXPORTER_DI_VARIANT, E_BILANZ_TRANSMITTER_DI_VARIANT, ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS } from '../e-bilanz.tokens';
import { EBilanzUtilities } from '../e-bilanz.utilities';
import { EBilanzAccountMapping, type EBilanzAccountMappingCreateData } from '../models/e-bilanz-account-mapping.model';
import { type EBilanzAccountBalance } from '../models/e-bilanz-account-balance.model';
import { type EBilanzBooks } from '../models/e-bilanz-books.model';
import { type EBilanzEquityLine } from '../models/e-bilanz-equity-line.model';
import { EBilanzFilingKind } from '../models/e-bilanz-filing-kind.enum';
import { EBilanzFiling, type EBilanzFilingCreateData } from '../models/e-bilanz-filing.model';
import { EBilanzIncomeStatementForm } from '../models/e-bilanz-income-statement-form.enum';
import { type EBilanzResultLine } from '../models/e-bilanz-result-line.model';
import { type EBilanzPreparationInput } from '../models/e-bilanz-preparation-input.model';
import { type EBilanzPreparation } from '../models/e-bilanz-preparation.model';
import { EBilanzSettings, type EBilanzSettingsCreateData } from '../models/e-bilanz-settings.model';
import { type EBilanzState } from '../models/e-bilanz-state.model';
import { EBilanzRevisionStatus } from '../models/e-bilanz-revision-status.enum';
import { type EBilanzTransmissionSummary } from '../models/e-bilanz-transmission-summary.model';
import { EBilanzTransmissionStatus } from '../models/e-bilanz-transmission-status.enum';
import { EBilanzNotSentError } from '../e-bilanz-not-sent.error';
import { type EBilanzTaxonomy } from '../models/e-bilanz-taxonomy.model';
import { type EBilanzExporterInterface } from './e-bilanz-exporter.interface';
import { type EBilanzExport, type EBilanzFile, type EBilanzServiceInterface } from './e-bilanz-service.interface';
import { type EBilanzTaxonomyAdapterInterface } from './e-bilanz-taxonomy-adapter.interface';
import { type EBilanzTransmission, type EBilanzTransmissionOptions, type EBilanzTransmitterInterface } from './e-bilanz-transmitter.interface';

/**
 * How long the lease of the transmissions of a fiscal year is granted for at a time. It is renewed while a
 * transmission runs, and lapses this long after the instance holding it stopped.
 */
const TRANSMISSION_LEASE_IN_MS: number = Ms.MINUTE;

/**
 * What a record that is no transmission states of one.
 */
const NO_TRANSMISSION: Pick<EBilanzFilingCreateData, 'status' | 'transmissionId' | 'mayHaveBeenSent' | 'error'> = {
    status: null,
    transmissionId: null,
    mayHaveBeenSent: false,
    error: null
};

/**
 * What a transmitter answered, or what it threw.
 */
type TransmitterOutcome = { readonly transmission: EBilanzTransmission } | { readonly error: unknown };

/**
 * What the record of the result of a transmission states beside what it takes from the record of its start.
 */
type TransmissionResultData = Pick<EBilanzFilingCreateData, 'status' | 'mayHaveBeenSent' | 'error' | 'succeeded' | 'ticket' | 'messages' | 'protocol' | 'createdBy'>;

/**
 * Prepares, exports and sends the E-Bilanz of the closed fiscal years of the current tenant from its books and the
 * company of its bookkeeping settings, and keeps the records of their filing, archived, and the ELSTER certificate the
 * E-Bilanz takes.
 */
@Injectable({ register: 'onUse' })
export class EBilanzService implements EBilanzServiceInterface {
    private get fiscalYearRepository(): Repository<FiscalYear> {
        return inject(repositoryTokenFor(FiscalYear));
    }

    private get settingsRepository(): Repository<EBilanzSettings, EBilanzSettingsCreateData> {
        return inject(repositoryTokenFor(EBilanzSettings));
    }

    private get mappingRepository(): Repository<EBilanzAccountMapping, EBilanzAccountMappingCreateData> {
        return inject(repositoryTokenFor(EBilanzAccountMapping));
    }

    private get filingRepository(): Repository<EBilanzFiling, EBilanzFilingCreateData> {
        return inject(repositoryTokenFor(EBilanzFiling));
    }

    private get accountRepository(): Repository<BookkeepingAccount> {
        return inject(repositoryTokenFor(BookkeepingAccount));
    }

    private get leaseService(): LeaseServiceInterface {
        return inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
    }

    private get reportService(): BookkeepingReportServiceInterface {
        return inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.REPORT_SERVICE);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolvePreparation(fiscalYearId: string, input: EBilanzPreparationInput): Promise<EBilanzPreparation> {
        const fiscalYear: FiscalYear = await this.resolveClosedFiscalYear(fiscalYearId);
        return EBilanzUtilities.resolvePreparation(await this.resolveBooks(fiscalYear, input));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async prepare(fiscalYearId: string, input: EBilanzPreparationInput, createdBy: string): Promise<EBilanzFiling> {
        const fiscalYear: FiscalYear = await this.resolveClosedFiscalYear(fiscalYearId);
        // a preparation after a filing corrects it, which the person preparing it says how, as the books cannot tell a
        // correction of an error from a change of a choice
        const filed: EBilanzFiling | undefined = (await this.findFilings(fiscalYear)).filter(f => this.isFiled(f)).at(-1);
        const revisionStatus: EBilanzRevisionStatus = input.revisionStatus ?? EBilanzRevisionStatus.ORIGINAL;
        if (filed == undefined && revisionStatus !== EBilanzRevisionStatus.ORIGINAL) {
            throw new ConflictError($ts`The E-Bilanz of the fiscal year is not filed, so it is prepared without a revisionStatus correcting one.`);
        }
        if (filed != undefined && revisionStatus === EBilanzRevisionStatus.ORIGINAL) {
            throw new ConflictError(
                $ts`The E-Bilanz of the fiscal year is filed, so a preparation corrects it and needs its revisionStatus: corrected, changed, corrected-and-changed, more-detail or other-correction.`
            );
        }
        const preparation: EBilanzPreparation = EBilanzUtilities.resolvePreparation(await this.resolveBooks(fiscalYear, input));
        if (preparation.findings.length) {
            const needs: string = preparation.findings.map(f => f.message).join(' ');
            throw new ConflictError($ts`The E-Bilanz needs the following before it can be prepared: ${needs}`);
        }
        return await this.createFiling(fiscalYear, {
            kind: EBilanzFilingKind.PREPARED,
            preparationId: null,
            contentHash: EBilanzUtilities.resolveContentHash(preparation.content),
            content: preparation.content,
            input: {
                accountingStandard: input.accountingStandard,
                taxonomyVersion: preparation.content.taxonomyVersion,
                fixedAssets: input.fixedAssets ?? [],
                revisionStatus
            },
            correctsFilingId: filed?.id ?? null,
            ...NO_TRANSMISSION,
            succeeded: true,
            ticket: null,
            messages: [],
            protocol: null,
            createdBy
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveState(fiscalYearId: string): Promise<EBilanzState> {
        const fiscalYear: FiscalYear = await this.fiscalYearRepository.findById(fiscalYearId);
        const filings: EBilanzFiling[] = await this.findFilingsConcluded(fiscalYear);
        const preparation: EBilanzFiling | undefined = filings.filter(f => f.kind === EBilanzFilingKind.PREPARED).at(-1);
        const settings: EBilanzSettings | undefined = await this.findSettings();
        const bookkeeping: BookkeepingSettings | undefined = await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.JOURNAL_SERVICE).findSettings();
        let current: EBilanzPreparation | undefined;
        if (preparation?.input != undefined && fiscalYear.closedAt != undefined) {
            current = EBilanzUtilities.resolvePreparation(await this.resolveBooks(fiscalYear, preparation.input));
        }
        const transmitter: EBilanzTransmitterInterface | undefined = this.findTransmitter();
        return {
            fiscalYearId,
            deadline: EBilanzDeadlineUtilities.resolveDeadline(fiscalYear.end, EBilanzUtilities.findGermanCompany(bookkeeping?.company)?.taxAdvisor ?? false),
            content: preparation?.content ?? null,
            findings: current?.findings ?? [],
            filings,
            transmissions: this.resolveTransmissions(filings),
            preparationId: preparation?.id ?? null,
            preparationCurrent: current != undefined && preparation != undefined
                && EBilanzUtilities.resolveContentHash(current.content) === preparation.contentHash,
            filed: filings.some(f => this.isFiled(f)),
            transmitterConfigured: transmitter != undefined && settings?.certificate != undefined && settings.certificatePin != undefined,
            transmitterUnavailableReason: transmitter == undefined
                ? $ts`No transmitter is registered: provide an EBilanzTransmitterInterface with E_BILANZ_TRANSMITTER_DI_VARIANT, or file an export by hand and record it.`
                : settings?.certificate == undefined || settings.certificatePin == undefined
                    ? $ts`The ELSTER certificate of the company and its PIN need to be uploaded.`
                    : null,
            exporters: this.resolveExporters().map(e => ({ name: e.name, mimeType: e.mimeType, fileExtension: e.fileExtension }))
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveExport(fiscalYearId: string, exporter: string): Promise<EBilanzExport> {
        const found: EBilanzExporterInterface | undefined = this.resolveExporters().find(e => e.name === exporter);
        if (found == undefined) {
            throw new ConflictError($ts`The exporter ${exporter} of the E-Bilanz needs to be registered with E_BILANZ_EXPORTER_DI_VARIANT.`);
        }
        const { fiscalYear, preparation } = await this.resolveCurrentPreparation(fiscalYearId);
        const content: EBilanzPreparation['content'] = this.resolvePreparedContent(preparation);
        const [start, end] = [fiscalYear.start, fiscalYear.end].map(day => BookkeepingDayUtilities.formatDay(day));
        return { name: `e-bilanz-${start}-${end}.${found.fileExtension}`, mimeType: found.mimeType, data: await found.resolveFile(content) };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async transmit(fiscalYearId: string, options: { readonly test: boolean }, actingUserId: string): Promise<EBilanzFiling> {
        // the request is answered once the start is recorded. The transmission goes on outside it, where the deadline
        // of the request refuses no write of its result
        return await new Promise<EBilanzFiling>((resolve, reject) => {
            AlsUtilities.runOutsideRequest(() => {
                this.runTransmission(fiscalYearId, options, actingUserId, resolve).then(
                    started => {
                        if (!started) {
                            reject(new ConflictError($ts`The E-Bilanz of the fiscal year is being sent, or filed by hand, right now.`));
                        }
                    },
                    // only an error before the start was recorded reaches this, as the transmission records its own
                    (error: unknown) => reject(error)
                );
            });
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async recordManualFiling(fiscalYearId: string, protocol: EBilanzFile, actingUserId: string): Promise<EBilanzFiling> {
        return await this.runInTransmissionLease(fiscalYearId, async () => {
            const { fiscalYear, preparation, filings } = await this.resolveCurrentPreparation(fiscalYearId);
            await this.concludeOpenTransmissions(fiscalYear, filings);
            if (filings.some(f => f.contentHash === preparation.contentHash && this.isFiled(f))) {
                throw new ConflictError($ts`The E-Bilanz of the fiscal year is filed as prepared.`);
            }
            return await this.createFiling(fiscalYear, {
                kind: EBilanzFilingKind.MANUAL_FILING,
                preparationId: preparation.id,
                contentHash: preparation.contentHash,
                content: null,
                input: null,
                correctsFilingId: null,
                ...NO_TRANSMISSION,
                succeeded: true,
                ticket: null,
                messages: [],
                protocol: (await this.storeFile(protocol, actingUserId)).id,
                createdBy: actingUserId
            });
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async recordNotReceived(fiscalYearId: string, actingUserId: string): Promise<EBilanzFiling[]> {
        return await this.runInTransmissionLease(fiscalYearId, async () => {
            const fiscalYear: FiscalYear = await this.fiscalYearRepository.findById(fiscalYearId);
            const filings: EBilanzFiling[] = await this.findFilings(fiscalYear);
            await this.concludeOpenTransmissions(fiscalYear, filings);
            const unknown: EBilanzTransmissionSummary[] = this.resolveTransmissions(await this.findFilings(fiscalYear))
                .filter(t => this.isNotKnown(t));
            if (!unknown.length) {
                throw new ConflictError($ts`The fiscal year has no transmission of the E-Bilanz whose result is not known.`);
            }
            const started: EBilanzFiling[] = unknown.flatMap(t => filings.find(f => f.id === t.id) ?? []);
            const res: EBilanzFiling[] = [];
            // one after the other, as each is a row of the chain of the tenant
            for (const transmission of started) {
                res.push(await this.createResult(fiscalYear, transmission, {
                    status: EBilanzTransmissionStatus.NOT_RECEIVED,
                    mayHaveBeenSent: false,
                    error: null,
                    succeeded: false,
                    ticket: null,
                    messages: [],
                    protocol: null,
                    createdBy: actingUserId
                }));
            }
            return res;
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async validateReopening(fiscalYearId: string, forCorrection: boolean, transaction: Transaction): Promise<void> {
        // held until the reopening commits or rolls back, so that no transmission starts from the year as it was closed
        const validated: true | undefined = await this.leaseService.withLease(
            { key: this.getTransmissionLeaseKey(fiscalYearId), leaseInMs: TRANSMISSION_LEASE_IN_MS, mode: 'skip', heldUntil: transaction },
            async () => {
                const fiscalYear: FiscalYear = await this.fiscalYearRepository.findById(fiscalYearId);
                await this.concludeOpenTransmissions(fiscalYear, await this.findFilings(fiscalYear));
                const filings: EBilanzFiling[] = await this.findFilings(fiscalYear);
                if (this.resolveTransmissions(filings).some(t => this.isNotKnown(t))) {
                    throw new ConflictError($ts`A transmission of the E-Bilanz of the fiscal year may have reached the tax administration, and its result is not known. Settle it before the fiscal year is reopened.`);
                }
                const filed: boolean = filings.some(f => this.isFiled(f));
                if (filed && !forCorrection) {
                    throw new ConflictError($ts`The E-Bilanz of the fiscal year is filed, and the fiscal year is reopened only to correct it, with forCorrection.`);
                }
                if (!filed && forCorrection) {
                    throw new ConflictError($ts`The E-Bilanz of the fiscal year is not filed, so there is nothing to correct: reopen it without forCorrection.`);
                }
                return true as const;
            }
        );
        if (validated == undefined) {
            throw new ConflictError($ts`The E-Bilanz of the fiscal year is being sent, or filed by hand, right now.`);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findSettings(): Promise<EBilanzSettings | undefined> {
        return await this.settingsRepository.findOne({ required: false });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateCertificate(certificate: EBilanzFile, pin: string, actingUserId: string): Promise<EBilanzSettings> {
        const record: FileRecord = await this.storeFile(certificate, actingUserId);
        const data: EBilanzSettingsCreateData = {
            certificate: record.id,
            certificatePin: pin,
            certificateUploadedAt: new Date(),
            certificateUploadedBy: actingUserId
        };
        const settings: EBilanzSettings | undefined = await this.findSettings();
        return settings == undefined
            ? await this.settingsRepository.create(data)
            : await this.settingsRepository.updateById(settings.id, data);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findAccountMappings(): Promise<EBilanzAccountMapping[]> {
        return await this.mappingRepository.findAll({ limit: 'all' });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateAccountMapping(mapping: EBilanzAccountMappingCreateData): Promise<EBilanzAccountMapping> {
        const account: BookkeepingAccount | undefined = await this.accountRepository.findOne({ where: { id: mapping.accountId }, required: false });
        if (account == undefined) {
            throw new ConflictError($ts`The account ${mapping.accountId} needs to be an account of the books.`);
        }
        const existing: EBilanzAccountMapping | undefined = await this.mappingRepository.findOne({ where: { accountId: mapping.accountId }, required: false });
        return existing == undefined
            ? await this.mappingRepository.create(mapping)
            : await this.mappingRepository.updateById(existing.id, { position: mapping.position, creditPosition: mapping.creditPosition ?? null });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteAccountMapping(accountId: string): Promise<void> {
        const existing: EBilanzAccountMapping | undefined = await this.mappingRepository.findOne({ where: { accountId }, required: false });
        if (existing != undefined) {
            await this.mappingRepository.deleteById(existing.id);
        }
    }

    /**
     * Resolves what the E-Bilanz of a closed fiscal year is resolved from: the balances of its accounts without the
     * closing entry, those of its opening entry, the statements archived at its closing, the company of the bookkeeping
     * settings, the version of the taxonomy and its adapter.
     * @param fiscalYear - The fiscal year.
     * @param input - What the preparation takes beside the books.
     * @returns The books.
     * @throws A ConflictError when no version of the taxonomy applies to the fiscal year.
     */
    protected async resolveBooks(fiscalYear: FiscalYear, input: EBilanzPreparationInput): Promise<EBilanzBooks> {
        const taxonomy: EBilanzTaxonomy | undefined = EBilanzTaxonomyUtilities.findTaxonomy(
            inject(ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.TAXONOMIES),
            fiscalYear.start,
            input.taxonomyVersion ?? undefined
        );
        if (taxonomy == undefined) {
            const start: string = BookkeepingDayUtilities.formatDay(fiscalYear.start);
            throw new ConflictError($ts`The E-Bilanz of a fiscal year starting on ${start} needs a version of the taxonomy registered in ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.TAXONOMIES.`);
        }
        const adapter: EBilanzTaxonomyAdapterInterface | undefined = inject(ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.TAXONOMY_ADAPTERS).find(a => a.name === taxonomy.adapter);
        if (adapter == undefined) {
            throw new InternalError(`The taxonomy ${taxonomy.version} of the E-Bilanz needs the adapter "${taxonomy.adapter}".`);
        }
        // one after the other, as the reads of the report service share what they resolve
        const trialBalance: BookkeepingTrialBalance = await this.reportService.resolveTrialBalance(fiscalYear.id, undefined);
        // the balances the year starts with: its opening entry, and the balances carried over by hand against a
        // carry-forward account, such as those of books kept elsewhere before
        const carried: BookkeepingCarriedBalances = await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.JOURNAL_SERVICE).resolveCarriedBalances(fiscalYear.id);
        const opening: Map<string, BookkeepingAccountBalance> = new Map(carried.balances.map(b => [b.account.id, b]));
        const statements: BookkeepingStatement[] = await this.resolveFullStatements(fiscalYear);
        const forms: { incomeStatement: string } = await this.reportService.resolveStatementForms(fiscalYear.id);
        const bookkeeping: BookkeepingSettings | undefined = await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.JOURNAL_SERVICE).findSettings();
        const previous: FiscalYear | undefined = await this.fiscalYearRepository.findOne({
            where: { end: BookkeepingDayUtilities.resolvePreviousDay(fiscalYear.start) },
            required: false
        });
        const balances: EBilanzAccountBalance[] = trialBalance.rows.map(row => ({
            account: row.account,
            debit: row.debit,
            credit: row.credit,
            openingDebit: opening.get(row.account.id)?.debit ?? new BigNumber(0),
            openingCredit: opening.get(row.account.id)?.credit ?? new BigNumber(0)
        }));
        const books: EBilanzBooks = {
            taxonomy,
            adapter,
            fiscalYear,
            previousFiscalYear: previous,
            company: bookkeeping?.company ?? undefined,
            accountingStandard: input.accountingStandard,
            incomeStatementForm: forms.incomeStatement === HGB_MICRO_INCOME_STATEMENT.id ? EBilanzIncomeStatementForm.MICRO : EBilanzIncomeStatementForm.TOTAL_COST,
            revisionStatus: input.revisionStatus ?? EBilanzRevisionStatus.ORIGINAL,
            balances,
            equityLines: [],
            // the account a UG posts its legal reserve from, § 5a (3) GmbHG, by the rules valid at the end of the year
            legalReserveAllocationAccountId: (await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_RULE_SERVICE).findRuleSets(fiscalYear.id))
                .at(-1)?.rules.reserveAllocationAccountId ?? undefined,
            resultLines: await this.resolveResultLines(fiscalYear),
            accountMappings: await this.findAccountMappings(),
            fixedAssets: input.fixedAssets ?? [],
            statements
        };
        // the lines of the accounts of the equity alone, which are known once the positions of the accounts are
        return { ...books, equityLines: await this.resolveEquityLines(fiscalYear, EBilanzUtilities.resolveEquityAccountIds(books), carried.entryIds) };
    }

    /**
     * Resolves the lines on accounts of the equity of every entry of a fiscal year but those carrying its balances in
     * and its closing entry.
     * @param fiscalYear - The fiscal year.
     * @param accountIds - The ids of the accounts of the equity.
     * @param carriedEntryIds - The ids of the entries carrying the balances of the year in.
     * @returns The lines, each its credit less its debit.
     */
    protected async resolveEquityLines(fiscalYear: FiscalYear, accountIds: ReadonlySet<string>, carriedEntryIds: readonly string[]): Promise<EBilanzEquityLine[]> {
        if (!accountIds.size) {
            return [];
        }
        // every closing, and the reversal of each a reopening took back
        const closings: JournalEntry[] = await inject(repositoryTokenFor(JournalEntry)).findAll({
            where: { fiscalYearId: fiscalYear.id, sourceType: FiscalYearEntrySourceType.CLOSING },
            limit: 'all'
        });
        const excluded: string[] = [...carriedEntryIds, ...closings.map(c => c.id)];
        const lines: JournalEntryLine[] = await inject(repositoryTokenFor(JournalEntryLine)).findAll({
            where: {
                fiscalYearId: fiscalYear.id,
                accountId: { oneOf: [...accountIds] },
                ...excluded.length ? { entryId: { notOneOf: excluded } } : {}
            },
            limit: 'all'
        });
        return lines.map(line => ({ entryId: line.entryId, accountId: line.accountId, amount: NumberUtilities.subtract(line.credit ?? 0, line.debit ?? 0) }));
    }

    /**
     * Resolves the lines of the closing entry of a fiscal year that carry its result into equity, those with the role
     * `RESULT`, with their accounts.
     * @param fiscalYear - The fiscal year.
     * @returns The lines, none for a fiscal year without a closing entry or a result.
     */
    protected async resolveResultLines(fiscalYear: FiscalYear): Promise<EBilanzResultLine[]> {
        // the closing that counts: the latest a reopening did not reverse, and no reversal itself
        const closings: JournalEntry[] = await inject(repositoryTokenFor(JournalEntry)).findAll({
            where: { fiscalYearId: fiscalYear.id, sourceType: FiscalYearEntrySourceType.CLOSING },
            order: { sequence: 'ASC' },
            limit: 'all'
        });
        const reversed: Set<string> = new Set(closings.flatMap(c => c.reversesEntryId ?? []));
        const entry: JournalEntry | undefined = closings.filter(c => c.reversesEntryId == undefined && !reversed.has(c.id)).at(-1);
        if (entry == undefined) {
            return [];
        }
        const lines: JournalEntryLine[] = await inject(repositoryTokenFor(JournalEntryLine)).findAll({
            where: { entryId: entry.id, role: JournalEntryLineRole.RESULT },
            order: { chainSequence: 'ASC' },
            limit: 'all'
        });
        if (!lines.length) {
            return [];
        }
        const accounts: BookkeepingAccount[] = await this.accountRepository.findAll({ where: { id: { oneOf: lines.map(l => l.accountId) } }, limit: 'all' });
        return lines.map(line => {
            const account: BookkeepingAccount | undefined = accounts.find(a => a.id === line.accountId);
            if (account == undefined) {
                throw new InternalError(`The account ${line.accountId} of the closing entry ${entry.id} is not one of the books.`);
            }
            return { account, amount: NumberUtilities.subtract(line.credit ?? 0, line.debit ?? 0) };
        });
    }

    /**
     * Resolves the full statements of a fiscal year, those archived at its closing, which the E-Bilanz is checked
     * against.
     * @param fiscalYear - The fiscal year.
     * @returns The balance sheet and the income statement in the full forms registered, none without.
     */
    protected async resolveFullStatements(fiscalYear: FiscalYear): Promise<BookkeepingStatement[]> {
        const structures: readonly BookkeepingStatementStructure[] = inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.STATEMENT_STRUCTURES);
        const full: (type: BookkeepingStatementType) => string | undefined = type => structures.find(s => s.type === type && s.rollsUpFrom == undefined)?.id;
        const balanceSheet: string | undefined = full(BookkeepingStatementType.BALANCE_SHEET);
        const incomeStatement: string | undefined = full(BookkeepingStatementType.INCOME_STATEMENT);
        return [
            ...balanceSheet == undefined ? [] : [await this.reportService.resolveBalanceSheet(fiscalYear.id, balanceSheet)],
            ...incomeStatement == undefined ? [] : [await this.reportService.resolveIncomeStatement(fiscalYear.id, incomeStatement)]
        ];
    }

    /**
     * Resolves the latest preparation of a closed fiscal year, which needs to state what the books state now.
     * @param fiscalYearId - The id of the fiscal year.
     * @returns The fiscal year, the preparation and every record of the fiscal year.
     * @throws A ConflictError without a preparation, or one the books state otherwise now.
     */
    protected async resolveCurrentPreparation(fiscalYearId: string): Promise<{ fiscalYear: FiscalYear, preparation: EBilanzFiling, filings: EBilanzFiling[] }> {
        const fiscalYear: FiscalYear = await this.resolveClosedFiscalYear(fiscalYearId);
        const filings: EBilanzFiling[] = await this.findFilings(fiscalYear);
        const preparation: EBilanzFiling | undefined = filings.filter(f => f.kind === EBilanzFilingKind.PREPARED).at(-1);
        if (preparation?.input == undefined) {
            throw new ConflictError($ts`The E-Bilanz of the fiscal year needs to be prepared first.`);
        }
        const current: EBilanzPreparation = EBilanzUtilities.resolvePreparation(await this.resolveBooks(fiscalYear, preparation.input));
        if (EBilanzUtilities.resolveContentHash(current.content) !== preparation.contentHash) {
            throw new ConflictError($ts`The books state the E-Bilanz of the fiscal year otherwise than it was prepared, and it needs to be prepared again.`);
        }
        return { fiscalYear, preparation, filings };
    }

    /**
     * Gets the content of a preparation.
     * @param preparation - The record of the preparation.
     * @returns Its content.
     * @throws An InternalError for a record without.
     */
    protected resolvePreparedContent(preparation: EBilanzFiling): EBilanzPreparation['content'] {
        if (preparation.content == undefined) {
            throw new InternalError(`The preparation ${preparation.id} of the E-Bilanz holds no content.`);
        }
        return preparation.content;
    }

    /**
     * Resolves a fiscal year of the books, which needs to be closed.
     * @param fiscalYearId - The id of the fiscal year.
     * @returns The fiscal year.
     * @throws A ConflictError for an open one.
     */
    protected async resolveClosedFiscalYear(fiscalYearId: string): Promise<FiscalYear> {
        const fiscalYear: FiscalYear = await this.fiscalYearRepository.findById(fiscalYearId);
        if (fiscalYear.closedAt == undefined) {
            const [start, end] = [fiscalYear.start, fiscalYear.end].map(day => BookkeepingDayUtilities.formatDay(day));
            throw new ConflictError($ts`The fiscal year from ${start} to ${end} needs to be closed before its E-Bilanz is prepared.`);
        }
        return fiscalYear;
    }

    /**
     * Finds the records of a fiscal year, the earliest first.
     * @param fiscalYear - The fiscal year.
     * @returns The records.
     */
    protected async findFilings(fiscalYear: FiscalYear): Promise<EBilanzFiling[]> {
        return await this.filingRepository.findAll({ where: { fiscalYearId: fiscalYear.id }, order: { chainSequence: 'ASC' }, limit: 'all' });
    }

    /**
     * Finds the records of a fiscal year, the earliest first, after concluding each transmission without a result
     * whose instance stopped as `unknown`.
     * @param fiscalYear - The fiscal year.
     * @returns The records.
     */
    protected async findFilingsConcluded(fiscalYear: FiscalYear): Promise<EBilanzFiling[]> {
        const filings: EBilanzFiling[] = await this.findFilings(fiscalYear);
        if (!this.findOpenTransmissions(filings).length) {
            return filings;
        }
        // a transmission still running holds the lease, on whichever instance. One whose instance stopped holds none
        // any more, and is concluded by whoever takes it
        const concluded: true | undefined = await this.leaseService.withLease(
            { key: this.getTransmissionLeaseKey(fiscalYear.id), leaseInMs: TRANSMISSION_LEASE_IN_MS, mode: 'skip' },
            async () => {
                // read again, as the transmission may have recorded its result since
                await this.concludeOpenTransmissions(fiscalYear, await this.findFilings(fiscalYear));
                return true as const;
            }
        );
        return concluded ? await this.findFilings(fiscalYear) : filings;
    }

    /**
     * Concludes each transmission of the records of a fiscal year without a result as `unknown`: the instance sending
     * it stopped. Called while holding the lease of its transmissions, so no transmission of it is running.
     * @param fiscalYear - The fiscal year.
     * @param filings - Its records, read while holding the lease.
     */
    protected async concludeOpenTransmissions(fiscalYear: FiscalYear, filings: EBilanzFiling[]): Promise<void> {
        // one after the other, as each is a row of the chain of the tenant
        for (const started of this.findOpenTransmissions(filings)) {
            const message: string = $ts`The transmission stopped before it had a result, such as when the application was restarted. The E-Bilanz may have reached the tax administration: check it in ELSTER.`;
            await this.createResult(fiscalYear, started, {
                status: EBilanzTransmissionStatus.UNKNOWN,
                mayHaveBeenSent: true,
                error: { name: 'EBilanzTransmissionStoppedError', message, paragraphs: [message] },
                succeeded: false,
                ticket: null,
                messages: [],
                protocol: null,
                createdBy: started.createdBy
            });
        }
    }

    /**
     * Finds the records starting a transmission that no record states the result of.
     * @param filings - The records of a fiscal year.
     * @returns The records.
     */
    protected findOpenTransmissions(filings: EBilanzFiling[]): EBilanzFiling[] {
        return filings.filter(f => f.status === EBilanzTransmissionStatus.TRANSMITTING && !filings.some(r => r.transmissionId === f.id));
    }

    /**
     * Resolves the transmissions of the records of a fiscal year, each with the result that decides where it stands:
     * the latest the transmitter answered, or else the latest concluded or confirmed without it.
     * @param filings - The records of a fiscal year, the earliest first.
     * @returns The transmissions, the earliest first.
     */
    protected resolveTransmissions(filings: EBilanzFiling[]): EBilanzTransmissionSummary[] {
        return filings.filter(f => f.status === EBilanzTransmissionStatus.TRANSMITTING).map(started => {
            // the latest decides: an unknown is only ever concluded before the transmitter answered, so what it answers
            // later replaces it, and a confirmation that it did not arrive replaces an unknown or a failure that may
            // have sent it
            const result: EBilanzFiling | undefined = filings.filter(f => f.transmissionId === started.id).at(-1);
            return {
                id: started.id,
                test: started.kind === EBilanzFilingKind.TEST_TRANSMISSION,
                status: result?.status ?? EBilanzTransmissionStatus.TRANSMITTING,
                mayHaveBeenSent: result?.mayHaveBeenSent ?? true,
                startedBy: started.createdBy,
                startedAt: started.createdAt,
                result: result ?? null
            };
        });
    }

    /**
     * Whether the result of a transmission is not known: concluded as `unknown`, or a failure that may have sent it.
     * Such a transmission keeps one of its kind from being sent until a person settles it.
     * @param transmission - The transmission.
     * @returns True when it is not known.
     */
    protected isNotKnown(transmission: EBilanzTransmissionSummary): boolean {
        return transmission.status === EBilanzTransmissionStatus.UNKNOWN
            || (transmission.status === EBilanzTransmissionStatus.FAILED && transmission.mayHaveBeenSent);
    }

    /**
     * Runs a transmission while holding the lease of the transmissions of its fiscal year: validates it, records its
     * start, hands that record over, calls the transmitter once and records its result.
     * @param fiscalYearId - The id of the fiscal year.
     * @param options - Whether as a test.
     * @param actingUserId - The id of the user sending it.
     * @param onStarted - Called with the record of the start, once it is written.
     * @returns False when another transmission or filing of the fiscal year holds the lease.
     * @throws A ConflictError for a transmission that is refused, before anything is recorded.
     */
    protected async runTransmission(
        fiscalYearId: string,
        options: { readonly test: boolean },
        actingUserId: string,
        onStarted: (started: EBilanzFiling) => void
    ): Promise<boolean> {
        const done: true | undefined = await this.leaseService.withLease(
            { key: this.getTransmissionLeaseKey(fiscalYearId), leaseInMs: TRANSMISSION_LEASE_IN_MS, mode: 'skip' },
            async () => {
                const transmitter: EBilanzTransmitterInterface | undefined = this.findTransmitter();
                if (transmitter == undefined) {
                    throw new ConflictError($ts`No transmitter is registered: provide an EBilanzTransmitterInterface with E_BILANZ_TRANSMITTER_DI_VARIANT, or file an export by hand and record it.`);
                }
                const settings: EBilanzSettings | undefined = await this.findSettings();
                if (settings?.certificate == undefined || settings.certificatePin == undefined) {
                    throw new ConflictError($ts`The ELSTER certificate of the company and its PIN need to be uploaded.`);
                }
                const { fiscalYear, preparation, filings } = await this.resolveCurrentPreparation(fiscalYearId);
                await this.concludeOpenTransmissions(fiscalYear, filings);
                const records: EBilanzFiling[] = await this.findFilings(fiscalYear);
                const ofPreparation: EBilanzFiling[] = records.filter(f => f.contentHash === preparation.contentHash);
                if (ofPreparation.some(f => this.isFiled(f))) {
                    throw new ConflictError($ts`The E-Bilanz of the fiscal year is filed as prepared.`);
                }
                // a filing by hand recorded after it settles what it left open
                const manualFiling: number = records.map(f => f.kind).lastIndexOf(EBilanzFilingKind.MANUAL_FILING);
                if (this.resolveTransmissions(records).some(t => t.test === options.test && this.isNotKnown(t)
                    && records.findIndex(f => f.id === t.id) > manualFiling)) {
                    throw new ConflictError($ts`A transmission of the E-Bilanz may have reached the tax administration, and its result is not known. Check it in ELSTER, then record the E-Bilanz as filed by hand, or confirm that the transmission did not arrive, before it is sent again.`);
                }
                if (!options.test && !ofPreparation.some(f => f.kind === EBilanzFilingKind.TEST_TRANSMISSION && f.succeeded)) {
                    throw new ConflictError($ts`The E-Bilanz needs to be sent as a test and accepted before it is sent for real.`);
                }
                const file: Buffer = await inject(ZIBRI_DI_TOKENS.FILE_SERVICE).read(settings.certificate);
                // recorded before the transmitter is called, so that a transmission that may have been sent is never
                // missing from the records, whatever happens to this instance
                const started: EBilanzFiling = await this.createFiling(fiscalYear, {
                    kind: options.test ? EBilanzFilingKind.TEST_TRANSMISSION : EBilanzFilingKind.TRANSMISSION,
                    preparationId: preparation.id,
                    contentHash: preparation.contentHash,
                    content: null,
                    input: null,
                    correctsFilingId: null,
                    status: EBilanzTransmissionStatus.TRANSMITTING,
                    transmissionId: null,
                    mayHaveBeenSent: true,
                    error: null,
                    succeeded: false,
                    ticket: null,
                    messages: [],
                    protocol: null,
                    createdBy: actingUserId
                });
                onStarted(started);
                await this.runTransmitter(
                    fiscalYear,
                    started,
                    transmitter,
                    this.resolvePreparedContent(preparation),
                    { test: options.test, certificate: { file, pin: settings.certificatePin } }
                );
                return true as const;
            }
        );
        return done === true;
    }

    /**
     * Calls the transmitter once and records its result. A transmitter that takes longer than the timeout of the
     * options is recorded as `unknown` and handed the abort of its signal, and what it answers later is recorded all
     * the same. Throws nothing: a result that cannot be written leaves the transmission without one, which is
     * concluded as `unknown` once the records are read.
     * @param fiscalYear - The fiscal year.
     * @param started - The record of the start.
     * @param transmitter - The transmitter.
     * @param content - The content prepared.
     * @param options - Whether as a test, and the certificate.
     */
    protected async runTransmitter(
        fiscalYear: FiscalYear,
        started: EBilanzFiling,
        transmitter: EBilanzTransmitterInterface,
        content: EBilanzPreparation['content'],
        options: OmitStrict<EBilanzTransmissionOptions, 'signal'>
    ): Promise<void> {
        const timeoutInMs: number = inject(ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.OPTIONS).transmissionTimeoutInMs;
        const controller: AbortController = new AbortController();
        // settled once, with what the transmitter answered or threw, as it may still answer after the timeout
        const answered: Promise<TransmitterOutcome> = (async () => {
            try {
                return { transmission: await transmitter.transmit(content, { ...options, signal: controller.signal }) };
            }
            catch (error) {
                return { error };
            }
        })();
        let timer: NodeJS.Timeout | undefined = undefined;
        const timedOut: Promise<undefined> = new Promise(resolve => {
            timer = setTimeout(() => resolve(undefined), timeoutInMs);
        });
        const outcome: TransmitterOutcome | undefined = await Promise.race([answered, timedOut]);
        clearTimeout(timer);
        if (outcome != undefined) {
            await this.recordSafely(started, async () => await this.recordOutcome(fiscalYear, started, outcome));
            return;
        }
        const message: string = $ts`The transmitter did not answer in time. The E-Bilanz may have reached the tax administration: check it in ELSTER.`;
        controller.abort(new Error(message));
        await this.recordSafely(started, async () => await this.createResult(fiscalYear, started, {
            status: EBilanzTransmissionStatus.UNKNOWN,
            mayHaveBeenSent: true,
            error: { name: 'EBilanzTransmissionTimeoutError', message, paragraphs: [message] },
            succeeded: false,
            ticket: null,
            messages: [],
            protocol: null,
            createdBy: started.createdBy
        }));
        // what it answers after the timeout is known, and replaces the unknown
        void answered.then(async late => await this.recordSafely(started, async () => await this.recordOutcome(fiscalYear, started, late)));
    }

    /**
     * Records what the transmitter answered or threw as the result of a transmission.
     * @param fiscalYear - The fiscal year.
     * @param started - The record of the start.
     * @param outcome - What the transmitter answered or threw.
     * @returns The record of the result.
     */
    protected async recordOutcome(fiscalYear: FiscalYear, started: EBilanzFiling, outcome: TransmitterOutcome): Promise<EBilanzFiling> {
        if ('transmission' in outcome) {
            const transmission: EBilanzTransmission = outcome.transmission;
            return await this.createResult(fiscalYear, started, {
                status: transmission.succeeded ? EBilanzTransmissionStatus.ACCEPTED : EBilanzTransmissionStatus.REFUSED,
                mayHaveBeenSent: true,
                error: null,
                succeeded: transmission.succeeded,
                ticket: transmission.ticket,
                messages: [...transmission.messages],
                protocol: transmission.protocol == undefined ? null : (await this.storeFile(transmission.protocol, started.createdBy)).id,
                createdBy: started.createdBy
            });
        }
        const thrown: Error = outcome.error instanceof Error ? outcome.error : new Error(String(outcome.error));
        return await this.createResult(fiscalYear, started, {
            status: EBilanzTransmissionStatus.FAILED,
            // a transmitter that says nothing about it may have sent it before it failed
            mayHaveBeenSent: !(thrown instanceof EBilanzNotSentError),
            error: { name: thrown.name, message: thrown.message, paragraphs: errorToLoggedError(thrown).paragraphs },
            succeeded: false,
            ticket: null,
            messages: [],
            protocol: null,
            createdBy: started.createdBy
        });
    }

    /**
     * Archives the result of a transmission, naming the record of its start.
     * @param fiscalYear - The fiscal year.
     * @param started - The record of the start.
     * @param data - The result.
     * @returns The record of the result.
     */
    protected async createResult(fiscalYear: FiscalYear, started: EBilanzFiling, data: TransmissionResultData): Promise<EBilanzFiling> {
        return await this.createFiling(fiscalYear, {
            ...data,
            kind: started.kind,
            preparationId: started.preparationId,
            contentHash: started.contentHash,
            content: null,
            input: null,
            correctsFilingId: null,
            transmissionId: started.id
        });
    }

    /**
     * Runs the writing of the result of a transmission, logging what fails instead of throwing it.
     * @param started - The record of the start.
     * @param write - The writing.
     */
    protected async recordSafely(started: EBilanzFiling, write: () => Promise<EBilanzFiling>): Promise<void> {
        try {
            await write();
        }
        catch (error) {
            inject(ZIBRI_DI_TOKENS.LOGGER).error(new InternalError(
                `The result of the transmission ${started.id} of the E-Bilanz could not be recorded. It is concluded as unknown once its records are read.`,
                { cause: error }
            ));
        }
    }

    /**
     * Runs work while holding the lease of the transmissions of a fiscal year.
     * @param fiscalYearId - The id of the fiscal year.
     * @param work - The work.
     * @returns What the work returns.
     * @throws A ConflictError while a transmission or a filing of the fiscal year holds it.
     */
    protected async runInTransmissionLease<T>(fiscalYearId: string, work: () => Promise<T>): Promise<T> {
        const res: { value: T } | undefined = await this.leaseService.withLease(
            { key: this.getTransmissionLeaseKey(fiscalYearId), leaseInMs: TRANSMISSION_LEASE_IN_MS, mode: 'skip' },
            async () => ({ value: await work() })
        );
        if (res == undefined) {
            throw new ConflictError($ts`The E-Bilanz of the fiscal year is being sent, or filed by hand, right now.`);
        }
        return res.value;
    }

    /**
     * Gets the key of the lease the transmissions of a fiscal year are held under, on every instance.
     * @param fiscalYearId - The id of the fiscal year.
     * @returns The key.
     */
    protected getTransmissionLeaseKey(fiscalYearId: string): string {
        return `e-bilanz:transmission:${fiscalYearId}`;
    }

    /**
     * Archives a record of a fiscal year, kept for the retention of the bookkeeping plugin.
     * @param fiscalYear - The fiscal year.
     * @param data - What it records.
     * @returns The record.
     */
    protected async createFiling(
        fiscalYear: FiscalYear,
        data: Omit<EBilanzFilingCreateData, 'fiscalYearId' | 'end' | 'createdAt' | 'retainUntil'>
    ): Promise<EBilanzFiling> {
        return await this.filingRepository.create({
            ...data,
            fiscalYearId: fiscalYear.id,
            end: fiscalYear.end,
            createdAt: new Date(),
            retainUntil: ArchiveUtilities.resolveRetainUntil(
                fiscalYear.end,
                { retention: inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS).retention, from: 'endOfYear' },
                inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS).defaultTimezone
            )
        });
    }

    /**
     * Stores a file in the store of the E-Bilanz.
     * @param file - The file.
     * @param createdBy - The id of the user it is of.
     * @returns The record of the file.
     */
    protected async storeFile(file: EBilanzFile, createdBy: string): Promise<FileRecord> {
        return await inject(ZIBRI_DI_TOKENS.FILE_SERVICE).store({
            store: inject(ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.FILE_STORE),
            name: file.name,
            mimeType: file.mimeType,
            data: file.data,
            createdBy
        });
    }

    /**
     * Whether a record files the E-Bilanz: an accepted transmission, or a filing by hand.
     * @param filing - The record.
     * @returns Whether it does.
     */
    protected isFiled(filing: EBilanzFiling): boolean {
        return (filing.kind === EBilanzFilingKind.TRANSMISSION && filing.succeeded) || filing.kind === EBilanzFilingKind.MANUAL_FILING;
    }

    /**
     * Finds the transmitter registered with `E_BILANZ_TRANSMITTER_DI_VARIANT`.
     * @returns The transmitter, or undefined for none.
     */
    protected findTransmitter(): EBilanzTransmitterInterface | undefined {
        return this.resolveVariant(
            E_BILANZ_TRANSMITTER_DI_VARIANT,
            'an E-Bilanz transmitter',
            (value): value is EBilanzTransmitterInterface => typeof value === 'object' && value != undefined && 'transmit' in value && typeof value.transmit === 'function'
        ).at(0);
    }

    /**
     * Resolves the exporters registered with `E_BILANZ_EXPORTER_DI_VARIANT`.
     * @returns The exporters.
     */
    protected resolveExporters(): EBilanzExporterInterface[] {
        return this.resolveVariant(
            E_BILANZ_EXPORTER_DI_VARIANT,
            'an E-Bilanz exporter',
            (value): value is EBilanzExporterInterface => typeof value === 'object' && value != undefined && 'resolveFile' in value && typeof value.resolveFile === 'function'
        );
    }

    private resolveVariant<T>(variant: DiVariant, kind: string, isKind: (value: unknown) => value is T): T[] {
        return getRegisteredProvidersOfVariant(variant).map(provider => {
            const value: unknown = inject(provider.token);
            if (!isKind(value)) {
                throw new InternalError(`${getDiTokenName(provider.token)} is provided as ${kind}, and needs to be one.`);
            }
            return value;
        });
    }
}
