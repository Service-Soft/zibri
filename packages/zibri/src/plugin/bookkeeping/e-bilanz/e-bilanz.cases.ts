/* eslint-disable cspell/spellchecker */
/* eslint-disable sonar/no-duplicate-string -- the position ids, columns, amounts and messages are the figures of the cases */
import { describe, expect, it } from '@jest/globals';

import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider, type DiProvider } from '../../../di/models/di-provider.model';
import { InjectionToken } from '../../../di/models/injection-token.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { ConflictError } from '../../../error-handling/errors/conflict.error';
import { MimeType } from '../../../http/mime-type.enum';
import { type Newable } from '../../../types/newable.type';
import { Ms } from '../../../utilities/ms';
import { BigNumber } from '../../../utilities/number.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { day, inTenant, journal } from '../bookkeeping.cases';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from '../bookkeeping.tokens';
import { BookkeepingAccountType } from '../models/bookkeeping-account-type.enum';
import { BookkeepingAccount, type BookkeepingAccountCreateData } from '../models/bookkeeping-account.model';
import { type BookkeepingClosingProposal } from '../models/bookkeeping-closing-proposal.model';
import { type BookkeepingCompany } from '../models/bookkeeping-company.model';
import { type BookkeepingObligation } from '../models/bookkeeping-obligation.model';
import { type FiscalYear } from '../models/fiscal-year.model';
import { UgConformanceService } from '../services/conformance/ug/ug-conformance.service';
import { EBilanzNotSentError } from './e-bilanz-not-sent.error';
import { E_BILANZ_TRANSMITTER_DI_VARIANT, ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS } from './e-bilanz.tokens';
import { EBilanzAccountMapping } from './models/e-bilanz-account-mapping.model';
import { EBilanzAccountingStandard } from './models/e-bilanz-accounting-standard.enum';
import { EBilanzFilingKind } from './models/e-bilanz-filing-kind.enum';
import { EBilanzFiling, type EBilanzFilingCreateData } from './models/e-bilanz-filing.model';
import { type EBilanzPosition } from './models/e-bilanz-position.model';
import { type EBilanzPreparationInput } from './models/e-bilanz-preparation-input.model';
import { type EBilanzPreparation } from './models/e-bilanz-preparation.model';
import { EBilanzRevisionStatus } from './models/e-bilanz-revision-status.enum';
import { EBilanzSettings } from './models/e-bilanz-settings.model';
import { type EBilanzState } from './models/e-bilanz-state.model';
import { EBilanzTransmissionStatus } from './models/e-bilanz-transmission-status.enum';
import { type EBilanzTransmissionSummary } from './models/e-bilanz-transmission-summary.model';
import { GermanBookkeepingCompany } from './models/german-bookkeeping-company.model';
import { EBilanzConformanceService } from './services/e-bilanz-conformance.service';
import { type EBilanzFile, type EBilanzServiceInterface } from './services/e-bilanz-service.interface';
import { type EBilanzTransmission, type EBilanzTransmissionOptions, type EBilanzTransmitterInterface } from './services/e-bilanz-transmitter.interface';

/**
 * The cases every data source answers the same way about the E-Bilanz: its content from the books of a closed fiscal
 * year, what it needs, the account mappings, its preparation, its transmission and filing by hand, and the obligation
 * the conformance asks. A file per data source runs them, with the entities of {@link eBilanzTestEntities} beside
 * those of the books and the providers of {@link eBilanzTestProviders}.
 */

/**
 * How a transmission of the recording transmitter answers, given what it was handed.
 */
export type RecordingTransmitterAnswer = (options: EBilanzTransmissionOptions) => Promise<EBilanzTransmission>;

/**
 * A transmitter that records what it was handed, and answers every transmission as accepted unless a case gives it
 * another answer.
 */
export class RecordingTransmitter implements EBilanzTransmitterInterface {

    readonly name: string = 'recording';

    /**
     * What each transmission was handed.
     */
    readonly transmissions: EBilanzTransmissionOptions[] = [];

    /**
     * How the transmissions answer, accepted by default. A case giving another puts it back with `answerAccepted`.
     */
    answer: RecordingTransmitterAnswer = async () => await this.resolveAccepted();

    async transmit(_eBilanz: unknown, options: EBilanzTransmissionOptions): Promise<EBilanzTransmission> {
        this.transmissions.push(options);
        return await this.answer(options);
    }

    /**
     * Answers every transmission from now on as accepted.
     */
    answerAccepted(): void {
        this.answer = async () => await this.resolveAccepted();
    }

    /**
     * Resolves an accepted transmission, with a ticket naming how many were sent and a protocol.
     * @returns The transmission.
     */
    async resolveAccepted(): Promise<EBilanzTransmission> {
        return await Promise.resolve({
            succeeded: true,
            ticket: `ticket-${this.transmissions.length}`,
            protocol: { name: 'protocol.pdf', mimeType: MimeType.PDF, data: Buffer.from('%PDF-1.4 protocol') },
            messages: []
        });
    }
}

/**
 * Waits until a transmission of a fiscal year of the current tenant has a result, as a frontend polls for it.
 * @param fiscalYearId - The id of the fiscal year.
 * @param transmissionId - The id of the record the transmission was started with.
 * @param until - Whether the transmission is where the case waits for it, by default once it has a result.
 * @returns The transmission.
 */
export async function waitForTransmission(
    fiscalYearId: string,
    transmissionId: string,
    until: (transmission: EBilanzTransmissionSummary) => boolean = t => t.status !== EBilanzTransmissionStatus.TRANSMITTING
): Promise<EBilanzTransmissionSummary> {
    for (let attempt: number = 0; attempt < 500; attempt++) {
        const found: EBilanzTransmissionSummary | undefined = (await service().resolveState(fiscalYearId)).transmissions
            .find(t => t.id === transmissionId);
        if (found != undefined && until(found)) {
            return found;
        }
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error(`The transmission ${transmissionId} did not get where the case waits for it.`);
}

/**
 * The transmitter of the cases.
 */
export const recordingTransmitter: RecordingTransmitter = new RecordingTransmitter();

/**
 * The entities of the E-Bilanz.
 */
export const eBilanzTestEntities: Newable<BaseEntity>[] = [EBilanzSettings, EBilanzAccountMapping, EBilanzFiling];

/**
 * The providers of the cases: the German company as the company of the bookkeeping settings, the conformance of the
 * E-Bilanz alone, and the recording transmitter.
 */
export const eBilanzTestProviders: DiProvider<unknown>[] = [
    defineProvider({ token: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: { tenantsWithoutBooks: 'post-nothing' } }),
    defineProvider({ token: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.COMPANY_MODEL, useValue: GermanBookkeepingCompany }),
    defineProvider({
        token: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.BOOKKEEPING_CONFORMANCE_SERVICES,
        // the legal reserve of a UG, § 5a (3) GmbHG, which its closing proposes and needs posted
        useFactory: () => [inject(EBilanzConformanceService), inject(UgConformanceService)]
    }),
    {
        token: new InjectionToken<EBilanzTransmitterInterface>('test.e_bilanz.transmitter'),
        useValue: recordingTransmitter,
        variants: [E_BILANZ_TRANSMITTER_DI_VARIANT]
    }
];

/**
 * The company of the cases.
 */
export const COMPANY: GermanBookkeepingCompany = {
    name: 'Acme Software GmbH',
    seat: 'Berlin',
    registerCourt: 'Amtsgericht Charlottenburg',
    registerNumber: 'HRB 123456 B',
    legalStatus: 'GmbH',
    taxNumber: '1121081508150',
    taxOfficeNumber: '1121',
    address: { street: 'Hauptstraße', houseNumber: '1', postalCode: '10115', city: 'Berlin', country: 'DE' },
    business: 'Software development',
    taxAdvisor: false
};

type AccountName = 'bank' | 'equipment' | 'capital' | 'result' | 'revenue' | 'rent' | 'suspense'
    | 'legalReserve' | 'allocation' | 'machinery' | 'software' | 'carryForward' | 'lossCarried';

const ACCOUNTS: Record<AccountName, BookkeepingAccountCreateData> = {
    bank: {
        number: '1200',
        name: 'Bank',
        type: BookkeepingAccountType.ASSET,
        statementPosition: 'assets.B.IV',
        creditStatementPosition: 'equity-and-liabilities.C.2'
    },
    equipment: { number: '0420', name: 'Office equipment', type: BookkeepingAccountType.ASSET, statementPosition: 'assets.A.II.3' },
    capital: {
        number: '0800',
        name: 'Share capital',
        type: BookkeepingAccountType.EQUITY,
        statementPosition: 'equity-and-liabilities.A.I'
    },
    result: {
        number: '0860',
        name: 'Profit carried forward',
        type: BookkeepingAccountType.EQUITY,
        statementPosition: 'equity-and-liabilities.A.IV'
    },
    revenue: { number: '8400', name: 'Revenue 19 %', type: BookkeepingAccountType.REVENUE, statementPosition: 'income-statement.1' },
    rent: { number: '4210', name: 'Rent', type: BookkeepingAccountType.EXPENSE, statementPosition: 'income-statement.8' },
    suspense: { number: '1590', name: 'Suspense', type: BookkeepingAccountType.ASSET, statementPosition: null },
    legalReserve: {
        number: '0846',
        name: 'Legal reserve',
        type: BookkeepingAccountType.EQUITY,
        statementPosition: 'equity-and-liabilities.A.III.1'
    },
    allocation: {
        number: '2496',
        name: 'Allocation to the legal reserve',
        type: BookkeepingAccountType.EQUITY,
        statementPosition: 'equity-and-liabilities.A.V'
    },
    machinery: { number: '0210', name: 'Machinery', type: BookkeepingAccountType.ASSET, statementPosition: 'assets.A.II.2' },
    software: { number: '0135', name: 'Software', type: BookkeepingAccountType.ASSET, statementPosition: 'assets.A.I.2' },
    // the carry-forward account of the SKR 03 and 04, which balances carried over from books kept elsewhere are posted
    // against: of the equity, and in no position
    carryForward: { number: '9000', name: 'Balances carried forward', type: BookkeepingAccountType.EQUITY, statementPosition: null },
    lossCarried: {
        number: '0868',
        name: 'Loss carried forward',
        type: BookkeepingAccountType.EQUITY,
        statementPosition: 'equity-and-liabilities.A.IV'
    }
};

/**
 * The books of a case: the tenant, its accounts and its fiscal year 2026.
 */
export type EBilanzCaseBooks = {

    tenantId: string,

    accounts: Record<AccountName, BookkeepingAccount>,

    fiscalYear: FiscalYear,
    /**
     * The fiscal year 2027 the closing of 2026 opens, or undefined while 2026 is open.
     */
    nextFiscalYear: FiscalYear | undefined
};

type Line = [AccountName, AccountName, string];

/**
 * What the books of a case post beside the entries of every case, whether the year is closed, the legal form and the
 * company.
 */
export type EBilanzCaseBooksOptions = {

    lines?: Line[],
    /**
     * The entries posting the capital in 2026, its 25000.00 paid into the bank by default.
     */
    capitalLines?: Line[],
    /**
     * The entries of a fiscal year 2025 before, closed into the opening entry of 2026, or none for 2026 as the first
     * fiscal year of the books.
     */
    previousYearLines?: Line[],

    close?: boolean,

    legalForm?: string,

    company?: GermanBookkeepingCompany | BookkeepingCompany | null
};

/**
 * The books of a UG putting a quarter of its net income of 8800.00 into its legal reserve, § 5a (3) GmbHG, beside
 * 500.00 carried forward from the year before, an opening balance of 2026.
 */
export const UG_LEGAL_RESERVE_BOOKS: EBilanzCaseBooksOptions = {
    legalForm: 'UG',
    company: { ...COMPANY, legalStatus: 'UG' },
    previousYearLines: [['bank', 'result', '500.00']],
    lines: [['allocation', 'legalReserve', '2200.00']]
};

/**
 * The books of a GmbH buying a machinery for 2000.00 and a software for 1000.00 beside its office equipment: fixed
 * assets in three positions of two groups.
 */
export const FIXED_ASSETS_BOOKS: EBilanzCaseBooksOptions = {
    lines: [['machinery', 'bank', '2000.00'], ['software', 'bank', '1000.00']]
};

/**
 * Starts the books of a GmbH with the year 2026, or with a year 2025 closed into it, and the company of the cases in
 * its settings, posts its capital, an office equipment, its revenue and its rent, each a debit and a credit account,
 * and closes the year unless said otherwise.
 * @param options - The entries posted beside, those of the year before, whether the year is closed, the legal form and
 * the company.
 * @returns The books.
 */
export async function createBooks(options: EBilanzCaseBooksOptions = {}): Promise<EBilanzCaseBooks> {
    const tenantId: string = UUIDUtilities.generate();
    return await inTenant(tenantId, async () => {
        await journal().createSettings({
            currency: 'EUR',
            legalForms: [{ legalForm: options.legalForm ?? 'GmbH', validFrom: day('2020-01-01') }],
            company: options.company === undefined ? COMPANY : options.company
        });
        const repository: Repository<BookkeepingAccount, BookkeepingAccountCreateData> = inject(repositoryTokenFor(BookkeepingAccount));
        const created: BookkeepingAccount[] = await repository.createAll(Object.values(ACCOUNTS));
        const createdOf: (name: AccountName) => BookkeepingAccount = name => {
            const found: BookkeepingAccount | undefined = created.find(a => a.number === ACCOUNTS[name].number);
            if (found == undefined) {
                throw new Error(`The account ${ACCOUNTS[name].number} was not created`);
            }
            return found;
        };
        const accounts: Record<AccountName, BookkeepingAccount> = {
            bank: createdOf('bank'),
            equipment: createdOf('equipment'),
            capital: createdOf('capital'),
            result: createdOf('result'),
            revenue: createdOf('revenue'),
            rent: createdOf('rent'),
            suspense: createdOf('suspense'),
            legalReserve: createdOf('legalReserve'),
            allocation: createdOf('allocation'),
            machinery: createdOf('machinery'),
            software: createdOf('software'),
            carryForward: createdOf('carryForward'),
            lossCarried: createdOf('lossCarried')
        };
        let fiscalYear: FiscalYear;
        if (options.previousYearLines == undefined) {
            fiscalYear = await journal().createFiscalYear({ start: day('2026-01-01') });
        }
        else {
            const previous: FiscalYear = await journal().createFiscalYear({ start: day('2025-01-01') });
            await postLines(accounts, options.previousYearLines, '2025-03-01', 'P');
            fiscalYear = (await journal().closeFiscalYear(previous.id, { resultAccountId: accounts.result.id })).nextFiscalYear;
        }
        await createLegalReserveRules(accounts, fiscalYear);
        await postLines(accounts, [
            ...options.capitalLines ?? [['bank', 'capital', '25000.00']],
            ['equipment', 'bank', '3000.00'],
            ['bank', 'revenue', '10000.00'],
            ['rent', 'bank', '1200.00'],
            ...options.lines ?? []
        ], '2026-03-01', 'B');
        const nextFiscalYear: FiscalYear | undefined = options.close === false
            ? undefined
            : (await journal().closeFiscalYear(fiscalYear.id, { resultAccountId: accounts.result.id })).nextFiscalYear;
        return { tenantId, accounts, fiscalYear, nextFiscalYear };
    });
}

/**
 * Posts an entry for each line, debiting the first account and crediting the second, in the active tenant.
 * @param accounts - The accounts of the books.
 * @param posted - The lines.
 * @param on - The posting date, such as `2026-03-01`.
 * @param prefix - What the document references start with.
 */
async function postLines(accounts: Record<AccountName, BookkeepingAccount>, posted: Line[], on: string, prefix: string): Promise<void> {
    for (const [index, [debit, credit, amount]] of posted.entries()) {
        await journal().post({
            documentDate: day(on),
            postingDate: day(on),
            documentReference: `${prefix}-${index}`,
            text: 'Booked',
            lines: [
                { accountId: accounts[debit].id, debit: new BigNumber(amount), credit: null },
                { accountId: accounts[credit].id, debit: null, credit: new BigNumber(amount) }
            ]
        });
    }
}

/**
 * Creates the posting rules of a fiscal year naming the accounts the legal reserve of a UG is posted on, § 5a (3)
 * GmbHG, in the active tenant.
 * @param accounts - The accounts of the books.
 * @param fiscalYear - The fiscal year.
 */
async function createLegalReserveRules(accounts: Record<AccountName, BookkeepingAccount>, fiscalYear: FiscalYear): Promise<void> {
    await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_RULE_SERVICE).createRuleSet({
        fiscalYearId: fiscalYear.id,
        rules: {
            revenueAccounts: [],
            outputTaxAccounts: [],
            inputTaxAccounts: [],
            paymentDifferenceAccounts: [],
            bankAccounts: [],
            legalReserveAccountId: accounts.legalReserve.id,
            reserveAllocationAccountId: accounts.allocation.id
        }
    });
}

/**
 * What preparing the Einheitsbilanz takes.
 */
export const UNIFIED: { accountingStandard: EBilanzAccountingStandard } = { accountingStandard: EBilanzAccountingStandard.UNIFIED };

/**
 * The office equipment bought in 2026, as a year after it states it: its acquisition costs at the start of the year,
 * which the books do not hold, and no depreciation.
 */
const EQUIPMENT_FROM_2026: EBilanzPreparationInput['fixedAssets'] = [
    {
        position: 'bs.ass.fixAss.tan.otherEquipm.misc',
        values: [
            { column: 'grossCost.beginning', amount: new BigNumber('3000.00') },
            { column: 'accDepr.beginning', amount: new BigNumber(0) }
        ]
    }
];

/**
 * Starts the books of a UG with 2026 open, posts the legal reserve its closing proposes, closes the year and prepares
 * its E-Bilanz.
 * @param options - The books, beside the legal form and the company of a UG.
 * @returns What each line of the proposals posts, and the preparation.
 */
async function closeUgWithProposals(options: EBilanzCaseBooksOptions): Promise<{ proposed: string[], preparation: EBilanzPreparation }> {
    const books: EBilanzCaseBooks = await createBooks({
        ...options,
        legalForm: 'UG',
        company: { ...COMPANY, legalStatus: 'UG' },
        close: false
    });
    return await inTenant(books.tenantId, async () => {
        const proposals: BookkeepingClosingProposal[] = await journal().resolveClosingProposals(books.fiscalYear.id);
        for (const proposal of proposals) {
            await journal().post(proposal.entry);
        }
        await journal().closeFiscalYear(books.fiscalYear.id, { resultAccountId: books.accounts.result.id });
        return {
            proposed: proposals.flatMap(p => p.entry.lines.flatMap(l => l.debit == undefined ? [] : [l.debit.toFixed(2)])),
            preparation: await service().resolvePreparation(books.fiscalYear.id, UNIFIED)
        };
    });
}

/**
 * Posts the entries of 2027, the year the closing of 2026 opens, closes it and prepares its E-Bilanz.
 * @param books - The books, 2026 closed.
 * @param lines - The entries of 2027.
 * @returns The preparation.
 */
async function prepareNextYear(books: EBilanzCaseBooks, lines: Line[]): Promise<EBilanzPreparation> {
    const next: FiscalYear | undefined = books.nextFiscalYear;
    if (next == undefined) {
        throw new Error('The closing of 2026 opens no fiscal year');
    }
    return await inTenant(books.tenantId, async () => {
        await postLines(books.accounts, lines, '2027-03-01', 'N');
        await journal().closeFiscalYear(next.id, { resultAccountId: books.accounts.result.id });
        return await service().resolvePreparation(next.id, { ...UNIFIED, fixedAssets: EQUIPMENT_FROM_2026 });
    });
}

/**
 * The protocol of a filing by hand.
 */
const PROTOCOL: EBilanzFile = { name: 'p.pdf', mimeType: MimeType.PDF, data: Buffer.from('p') };

/**
 * The books of a case sending the E-Bilanz, and the record of its preparation.
 */
type EBilanzTransmittableBooks = EBilanzCaseBooks & {
    preparation: EBilanzFiling
};

function service(): EBilanzServiceInterface {
    return inject(ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.E_BILANZ_SERVICE);
}

/**
 * Creates the books of a case, prepares their E-Bilanz and uploads the certificate, so that it can be sent.
 * @returns The books and the preparation.
 */
async function createTransmittableBooks(): Promise<EBilanzTransmittableBooks> {
    const books: EBilanzCaseBooks = await createBooks();
    return await inTenant(books.tenantId, async () => {
        const preparation: EBilanzFiling = await service().prepare(books.fiscalYear.id, UNIFIED, 'ada');
        await service().updateCertificate(
            { name: 'acme.pfx', mimeType: 'application/x-pkcs12', data: Buffer.from('pfx') },
            'secret-pin',
            'ada'
        );
        return { ...books, preparation };
    });
}

function positionOf(preparation: EBilanzPreparation, name: string): EBilanzPosition | undefined {
    return preparation.content.positions.find(p => p.name === name);
}

function amountOf(preparation: EBilanzPreparation, name: string): string | null | undefined {
    const position: EBilanzPosition | undefined = positionOf(preparation, name);
    return position == undefined ? undefined : position.amount?.toFixed(2) ?? null;
}

/**
 * The steuerlicher Betriebsvermögensvergleich of a preparation, each position with its amount.
 * @param preparation - The preparation.
 * @returns The positions, in the order of the taxonomy.
 */
function businessAssetComparisonOf(preparation: EBilanzPreparation): [string, string | null][] {
    return preparation.content.positions
        .filter(p => p.statement === 'businessAssetComparison')
        .map(p => [p.name, p.amount?.toFixed(2) ?? null]);
}

/**
 * The amounts of the steuerlicher Betriebsvermögensvergleich of a corporation.
 */
type BusinessAssetComparisonFigures = {
    /**
     * The equity at the end of the year.
     */
    end: string,
    /**
     * The equity at the end of the year before.
     */
    before: string,
    /**
     * The distributions of the year.
     */
    distributions: string,
    /**
     * The contributions of the year.
     */
    contributions: string,
    /**
     * The result of the year.
     */
    result: string
};

/**
 * The steuerlicher Betriebsvermögensvergleich of a corporation, by its amounts.
 * @param figures - The equity at the end and at the end of the year before, the distributions, the contributions and
 * the result.
 * @returns The positions with their amounts, the adjustment of the equity of the year before 0.
 */
function businessAssetComparison(figures: BusinessAssetComparisonFigures): [string, string][] {
    return [
        ['BVV.profitLoss', figures.result],
        ['BVV.profitLoss.assetsCurrentYear', figures.end],
        ['BVV.profitLoss.assetsPreviousYear', figures.before],
        ['BVV.profitLoss.assetsPreviousYear.assets', figures.before],
        ['BVV.profitLoss.assetsPreviousYear.capAdjustments', '0.00'],
        ['BVV.profitLoss.withdrawalDistrib', figures.distributions],
        ['BVV.profitLoss.contribution', figures.contributions]
    ];
}

/**
 * Runs the cases of the E-Bilanz.
 * @param dataSourceName - The name of the data source, for the name of the suite.
 */
export function describeEBilanz(dataSourceName: string): void {
    describe(`the E-Bilanz on ${dataSourceName}`, () => {
        it('states each account under its position, the sums, and NIL for each position the tax administration asks for', async () => {
            const books: EBilanzCaseBooks = await createBooks();
            const preparation: EBilanzPreparation = await inTenant(
                books.tenantId,
                async () => await service().resolvePreparation(books.fiscalYear.id, UNIFIED)
            );

            expect(preparation.findings).toStrictEqual([]);
            expect(preparation.content.taxonomyVersion).toBe('6.9');
            // the company of the bookkeeping settings, with what the GCD module asks of it
            expect(preparation.content.company).toStrictEqual(COMPANY);
            expect(amountOf(preparation, 'bs.ass')).toBe('33800.00');
            expect(amountOf(preparation, 'bs.eqLiab')).toBe('33800.00');
            expect(amountOf(preparation, 'bs.ass.currAss.cashEquiv.misc')).toBe('30800.00');
            expect(amountOf(preparation, 'bs.ass.fixAss.tan.otherEquipm.misc')).toBe('3000.00');
            expect(amountOf(preparation, 'bs.eqLiab.equity.subscribed.corp')).toBe('25000.00');
            // the result of the year, as the balance sheet of the books states it, on the account the closing books it to
            expect(amountOf(preparation, 'bs.eqLiab.equity.netIncome')).toBe('8800.00');
            const carriedForward: Record<string, unknown> = {
                accountId: books.accounts.result.id,
                number: '0860',
                name: 'Profit carried forward',
                balance: new BigNumber('8800')
            };
            expect(positionOf(preparation, 'bs.eqLiab.equity.netIncome')?.accounts).toStrictEqual([carriedForward]);
            expect(amountOf(preparation, 'is.netIncome')).toBe('8800.00');
            expect(amountOf(preparation, 'is.netIncome.regular.operatingTC.otherCost.misc')).toBe('1200.00');
            // NIL: asked for below a position stated, and nothing in the books
            expect(amountOf(preparation, 'bs.ass.fixAss.intan.goodwill')).toBeNull();
            expect(amountOf(preparation, 'bs.eqLiab.equity.capRes')).toBeNull();
            const bank: Record<string, unknown> = {
                accountId: books.accounts.bank.id,
                number: '1200',
                name: 'Bank',
                balance: new BigNumber('30800')
            };
            expect(positionOf(preparation, 'bs.ass.currAss.cashEquiv.misc')?.accounts).toStrictEqual([bank]);
            // the book value at the end, the balance sheet's, and the sums it is made of
            const equipment: [string, string | undefined][] = [
                ['all', '3000.00'],
                ['gross', '3000.00'],
                ['grossCost.beginning', '0.00'],
                ['gross.addition', '3000.00'],
                ['accDepr', '0.00'],
                ['accDepr.beginning', '0.00']
            ];
            // and each position above it, up to the fixed assets
            expect(preparation.content.fixedAssets.map(f => [
                f.position,
                f.values.filter(v => v.amount != undefined).map(v => [v.column, v.amount?.toFixed(2)])
            ])).toStrictEqual([
                ['bs.ass.fixAss', equipment],
                ['bs.ass.fixAss.tan', equipment],
                ['bs.ass.fixAss.tan.otherEquipm', equipment],
                ['bs.ass.fixAss.tan.otherEquipm.misc', equipment]
            ]);
            expect(preparation.content.fields.find(f => f.name === 'genInfo.company.id.name')?.value).toBe('Acme Software GmbH');
            expect(preparation.content.fields.find(f => f.name === 'genInfo.company.id.idNo.type.companyId.BF4')?.value).toBe('1121');
            expect(preparation.content.fields.find(f => f.name === 'genInfo.report.period.fiscalYearEnd')?.value).toBe('2026-12-31');
            expect(preparation.content.fields.find(f => f.name === 'genInfo.report.id.reportElement.reportElements.BAL')?.value)
                .toBe('true');
            // the whole result carried forward: the Jahresüberschuss, NIL for the Bilanzgewinn the tax administration
            // asks for, and no appropriation of profits
            expect(amountOf(preparation, 'bs.eqLiab.equity.profitLoss')).toBeNull();
            expect(preparation.content.positions.filter(p => p.statement === 'appropriationOfProfits')).toStrictEqual([]);
            expect(preparation.content.fields.find(f => f.name === 'genInfo.report.id.incomeStatementendswithBalProfit')?.value)
                .toBe('false');
            expect(preparation.content.fields.find(f => f.name === 'genInfo.report.id.reportElement.reportElements.EV')?.value).toBeNull();
        });

        // a first fiscal year has no opening entry: the equity before it is 0, and the capital paid in a contribution
        it('states the steuerlicher Betriebsvermögensvergleich of a first fiscal year, its capital paid in as a contribution', async () => {
            const books: EBilanzCaseBooks = await createBooks();
            const preparation: EBilanzPreparation = await inTenant(
                books.tenantId,
                async () => await service().resolvePreparation(books.fiscalYear.id, UNIFIED)
            );

            expect(preparation.findings).toStrictEqual([]);
            expect(businessAssetComparisonOf(preparation)).toStrictEqual(businessAssetComparison({
                end: '33800.00',
                before: '0.00',
                distributions: '0.00',
                contributions: '25000.00',
                result: '8800.00'
            }));
            expect(preparation.content.fields.find(f => f.name === 'genInfo.report.id.reportElement.reportElements.BVV')?.value)
                .toBe('true');
        });

        it('states the steuerlicher Betriebsvermögensvergleich of a fiscal year after another, '
            + 'the equity before it that of its opening entry', async () => {
            const books: EBilanzCaseBooks = await createBooks();
            // 5000.00 of the profit of 2026 distributed, and a result of 1500.00
            const preparation: EBilanzPreparation = await prepareNextYear(books, [
                ['result', 'bank', '5000.00'],
                ['bank', 'revenue', '2000.00'],
                ['rent', 'bank', '500.00']
            ]);

            expect(preparation.findings).toStrictEqual([]);
            expect(businessAssetComparisonOf(preparation)).toStrictEqual(businessAssetComparison({
                end: '30300.00',
                before: '33800.00',
                distributions: '5000.00',
                contributions: '0.00',
                result: '1500.00'
            }));
        });

        it('states the equity before a fiscal year after another without an opening entry as 0', async () => {
            // the year before closed without a balance posts no opening entry
            const books: EBilanzCaseBooks = await createBooks({ previousYearLines: [] });
            const preparation: EBilanzPreparation = await inTenant(
                books.tenantId,
                async () => await service().resolvePreparation(books.fiscalYear.id, UNIFIED)
            );

            expect(preparation.findings).toStrictEqual([]);
            expect(businessAssetComparisonOf(preparation)).toStrictEqual(businessAssetComparison({
                end: '33800.00',
                before: '0.00',
                distributions: '0.00',
                contributions: '25000.00',
                result: '8800.00'
            }));
        });

        // the books kept elsewhere before, carried over by hand against the carry-forward account: 25000.00 of capital
        // and 4000.00 of profit, in the bank
        const CARRIED_OVER: Line[] = [
            ['carryForward', 'capital', '25000.00'],
            ['carryForward', 'result', '4000.00'],
            ['bank', 'carryForward', '29000.00']
        ];

        it('states the balances carried over against the carry-forward accounts as the equity before the first fiscal year', async () => {
            const books: EBilanzCaseBooks = await createBooks({ capitalLines: CARRIED_OVER });
            const preparation: EBilanzPreparation = await inTenant(
                books.tenantId,
                async () => await service().resolvePreparation(books.fiscalYear.id, UNIFIED)
            );

            expect(preparation.findings).toStrictEqual([]);
            expect(businessAssetComparisonOf(preparation)).toStrictEqual(businessAssetComparison({
                end: '37800.00',
                before: '29000.00',
                distributions: '0.00',
                contributions: '0.00',
                result: '8800.00'
            }));
        });

        it('states a contribution beside the balances carried over as one', async () => {
            const books: EBilanzCaseBooks = await createBooks({ capitalLines: [...CARRIED_OVER, ['bank', 'capital', '5000.00']] });
            const preparation: EBilanzPreparation = await inTenant(
                books.tenantId,
                async () => await service().resolvePreparation(books.fiscalYear.id, UNIFIED)
            );

            expect(preparation.findings).toStrictEqual([]);
            expect(businessAssetComparisonOf(preparation)).toStrictEqual(businessAssetComparison({
                end: '42800.00',
                before: '29000.00',
                distributions: '0.00',
                contributions: '5000.00',
                result: '8800.00'
            }));
        });

        it('states an asset carried over against a carry-forward account at the start of the year, not as an addition of it', async () => {
            // the office equipment of 5000.00 carried over, and 3000.00 of it bought in the year
            const books: EBilanzCaseBooks = await createBooks({
                capitalLines: [['carryForward', 'capital', '5000.00'], ['equipment', 'carryForward', '5000.00']]
            });
            const prepare: (fixedAssets: EBilanzPreparationInput['fixedAssets']) => Promise<EBilanzPreparation>
                = async fixedAssets => await inTenant(
                    books.tenantId,
                    async () => await service().resolvePreparation(books.fiscalYear.id, { ...UNIFIED, fixedAssets })
                );

            const unnamed: EBilanzPreparation = await prepare([]);
            expect(unnamed.findings.map(f => f.position)).toStrictEqual(['bs.ass.fixAss.tan.otherEquipm.misc']);
            const named: EBilanzPreparation = await prepare([
                {
                    position: 'bs.ass.fixAss.tan.otherEquipm.misc',
                    values: [
                        { column: 'grossCost.beginning', amount: new BigNumber('5000.00') },
                        { column: 'accDepr.beginning', amount: new BigNumber(0) }
                    ]
                }
            ]);
            expect(named.findings).toStrictEqual([]);
            expect(named.content.fixedAssets.find(f => f.position === 'bs.ass.fixAss.tan.otherEquipm.misc')?.values
                .filter(v => ['grossCost.beginning', 'gross.addition', 'all'].includes(v.column))
                .map(v => [v.column, v.amount?.toFixed(2)]))
                .toStrictEqual([['all', '8000.00'], ['grossCost.beginning', '5000.00'], ['gross.addition', '3000.00']]);
        });

        // a UG moving over from books kept elsewhere: 5000.00 of capital, and a loss or a profit carried forward, carried
        // over against the carry-forward account. The legal reserve is a quarter of the result less a loss carried
        // forward, § 5a (3) GmbHG, whether the opening entry carries the loss in or the carry-over does
        it('takes a loss carried over against a carry-forward account from the base of the legal reserve of a UG, '
            + 'and states it carried forward', async () => {
            const { proposed, preparation } = await closeUgWithProposals({
                capitalLines: [
                    ['carryForward', 'capital', '5000.00'],
                    ['lossCarried', 'carryForward', '3000.00'],
                    ['bank', 'carryForward', '2000.00']
                ]
            });

            // a quarter of 8800.00 less 3000.00
            expect(proposed).toStrictEqual(['1450.00']);
            expect(preparation.findings).toStrictEqual([]);
            expect(amountOf(preparation, 'incomeUse.gainLoss.accumLossPrevYear')).toBe('3000.00');
            expect(amountOf(preparation, 'incomeUse.gainLoss.retainedEarningsPrevYear')).toBeNull();
            expect(amountOf(preparation, 'incomeUse.gainLoss.additionRevenReserves.legalRes')).toBe('1450.00');
            expect(amountOf(preparation, 'incomeUse.gainLoss')).toBe('4350.00');
            expect(amountOf(preparation, 'bs.eqLiab.equity.profitLoss')).toBe('4350.00');
            expect(businessAssetComparisonOf(preparation)).toStrictEqual(businessAssetComparison({
                end: '10800.00',
                before: '2000.00',
                distributions: '0.00',
                contributions: '0.00',
                result: '8800.00'
            }));
        });

        it('takes nothing from the base of the legal reserve of a UG '
            + 'for a profit carried over against a carry-forward account', async () => {
            const { proposed, preparation } = await closeUgWithProposals({
                capitalLines: [
                    ['carryForward', 'capital', '5000.00'],
                    ['carryForward', 'result', '4000.00'],
                    ['bank', 'carryForward', '9000.00']
                ]
            });

            expect(proposed).toStrictEqual(['2200.00']);
            expect(preparation.findings).toStrictEqual([]);
            expect(amountOf(preparation, 'incomeUse.gainLoss.retainedEarningsPrevYear')).toBe('4000.00');
            expect(amountOf(preparation, 'incomeUse.gainLoss.additionRevenReserves.legalRes')).toBe('2200.00');
            expect(amountOf(preparation, 'incomeUse.gainLoss')).toBe('10600.00');
        });

        it('takes a loss the opening entry carries in from the base of the legal reserve of a UG, as before', async () => {
            // a loss of 3000.00 in 2025, closed into the profit carried forward
            const { proposed, preparation } = await closeUgWithProposals({ previousYearLines: [['rent', 'bank', '3000.00']] });

            expect(proposed).toStrictEqual(['1450.00']);
            expect(preparation.findings).toStrictEqual([]);
            expect(amountOf(preparation, 'incomeUse.gainLoss.accumLossPrevYear')).toBe('3000.00');
            expect(amountOf(preparation, 'incomeUse.gainLoss.additionRevenReserves.legalRes')).toBe('1450.00');
            expect(amountOf(preparation, 'incomeUse.gainLoss')).toBe('4350.00');
        });

        // the closing carries the accounts appropriating the result into the account the result is carried to, so the
        // year after starts with neither the allocation of the year before nor its part of the profit carried forward
        it('states the appropriation of a UG in the year after one appropriating its result, '
            + 'by the allocation of the year alone', async () => {
            const books: EBilanzCaseBooks = await createBooks(UG_LEGAL_RESERVE_BOOKS);
            // a result of 1500.00, a quarter of it into the legal reserve, by the posting rules 2026 carries forward
            const preparation: EBilanzPreparation = await prepareNextYear(books, [
                ['bank', 'revenue', '2000.00'],
                ['rent', 'bank', '500.00'],
                ['allocation', 'legalReserve', '375.00']
            ]);

            expect(preparation.findings).toStrictEqual([]);
            // 500.00 carried into 2026, and its 8800.00 less the 2200.00 allocated
            expect(amountOf(preparation, 'incomeUse.gainLoss.retainedEarningsPrevYear')).toBe('7100.00');
            expect(amountOf(preparation, 'incomeUse.gainLoss.additionRevenReserves.legalRes')).toBe('375.00');
            expect(amountOf(preparation, 'incomeUse.gainLoss.netIncome')).toBe('1500.00');
            expect(amountOf(preparation, 'incomeUse.gainLoss')).toBe('8225.00');
            expect(amountOf(preparation, 'bs.eqLiab.equity.profitLoss')).toBe('8225.00');
            expect(amountOf(preparation, 'bs.eqLiab.equity.revenueRes.legal')).toBe('2575.00');
        });

        it('states the balance sheet profit and the appropriation of profits of a UG '
            + 'putting part of its profit into the legal reserve', async () => {
            const books: EBilanzCaseBooks = await createBooks(UG_LEGAL_RESERVE_BOOKS);
            const preparation: EBilanzPreparation = await inTenant(
                books.tenantId,
                async () => await service().resolvePreparation(books.fiscalYear.id, UNIFIED)
            );

            expect(preparation.findings).toStrictEqual([]);
            expect(amountOf(preparation, 'bs.eqLiab.equity.profitLoss')).toBe('7100.00');
            // the account the closing books the result to carries it forward: one line of the balance sheet profit, with
            // the 500.00 it held and the result
            expect(positionOf(preparation, 'bs.eqLiab.equity.profitLoss')?.accounts.map(a => [a.number, a.balance.toFixed(2)]))
                .toStrictEqual([['0860', '9300.00'], ['2496', '-2200.00']]);
            expect(amountOf(preparation, 'bs.eqLiab.equity.netIncome')).toBeNull();
            expect(amountOf(preparation, 'bs.eqLiab.equity.retainedEarnings')).toBeNull();
            expect(amountOf(preparation, 'bs.eqLiab.equity.revenueRes.legal')).toBe('2200.00');
            expect(amountOf(preparation, 'bs.eqLiab')).toBe(amountOf(preparation, 'bs.ass'));
            expect(amountOf(preparation, 'incomeUse.gainLoss.netIncome')).toBe('8800.00');
            expect(amountOf(preparation, 'incomeUse.gainLoss.retainedEarningsPrevYear')).toBe('500.00');
            expect(amountOf(preparation, 'incomeUse.gainLoss.additionRevenReserves.legalRes')).toBe('2200.00');
            expect(amountOf(preparation, 'incomeUse.gainLoss.additionRevenReserves')).toBe('2200.00');
            expect(amountOf(preparation, 'incomeUse.gainLoss')).toBe('7100.00');
            // NIL: asked for below the appropriation stated
            expect(amountOf(preparation, 'incomeUse.gainLoss.dividensPlanned')).toBeNull();
            expect(positionOf(preparation, 'incomeUse.gainLoss.additionRevenReserves.legalRes')?.accounts
                .map(a => [a.number, a.balance.toFixed(2)]))
                .toStrictEqual([['2496', '2200.00']]);
            expect(preparation.content.fields.find(f => f.name === 'genInfo.report.id.incomeStatementendswithBalProfit')?.value)
                .toBe('true');
            expect(preparation.content.fields.find(f => f.name === 'genInfo.report.id.reportElement.reportElements.EV')?.value)
                .toBe('true');
            // the 500.00 carried forward is the equity before the year, and the allocation to the legal reserve, within
            // the equity, neither a contribution nor a distribution
            expect(businessAssetComparisonOf(preparation)).toStrictEqual(businessAssetComparison({
                end: '34300.00',
                before: '500.00',
                distributions: '0.00',
                contributions: '25000.00',
                result: '8800.00'
            }));
        });

        it('lists the account the closing books the result to under the result, '
            + 'and with its own balance under its own position', async () => {
            // 500.00 carried forward from before on the account the result is closed to
            const books: EBilanzCaseBooks = await createBooks({ lines: [['bank', 'result', '500.00']] });
            const preparation: EBilanzPreparation = await inTenant(
                books.tenantId,
                async () => await service().resolvePreparation(books.fiscalYear.id, UNIFIED)
            );
            const accountsOf: (name: string) => string[][] | undefined = name => positionOf(preparation, name)?.accounts
                .map(a => [a.number, a.balance.toFixed(2)]);

            expect(preparation.findings).toStrictEqual([]);
            expect([accountsOf('bs.eqLiab.equity.retainedEarnings'), accountsOf('bs.eqLiab.equity.netIncome')])
                .toStrictEqual([[['0860', '500.00']], [['0860', '8800.00']]]);
            expect([amountOf(preparation, 'bs.eqLiab.equity.retainedEarnings'), amountOf(preparation, 'bs.eqLiab.equity.netIncome')])
                .toStrictEqual(['500.00', '8800.00']);
        });

        it('names what it needs: the company, and each account with a balance and no position', async () => {
            const books: EBilanzCaseBooks = await createBooks({ company: null, lines: [['suspense', 'bank', '100.00']] });
            const preparation: EBilanzPreparation = await inTenant(
                books.tenantId,
                async () => await service().resolvePreparation(books.fiscalYear.id, UNIFIED)
            );

            // and the balance sheet does not balance without the account
            expect(preparation.findings.map(f => f.position)).toStrictEqual(['1590', 'genInfo.company', 'bs.ass']);
            // in plain language, with the amounts as a person reads them
            expect([preparation.findings[0]?.message, preparation.findings[2]?.message]).toStrictEqual([
                'The account 1590 "Suspense" has a balance and needs a position in the E-Bilanz: map it to a position of the taxonomy 6.9, '
                + 'or give it a statement position the taxonomy maps.',
                'The balance sheet does not balance: the assets total €33,700.00, and the equity and liabilities €33,800.00. '
                + 'Each account with a balance needs a position on its side of the balance sheet.'
            ]);
            await expect(inTenant(books.tenantId, async () => await service().prepare(books.fiscalYear.id, UNIFIED, 'ada')))
                .rejects.toThrow(ConflictError);
        });

        it('names the company as needed while the bookkeeping settings hold only what the generic company has', async () => {
            // as written while the application had not registered the German company yet
            const books: EBilanzCaseBooks = await createBooks({ company: { name: COMPANY.name } });
            const preparation: EBilanzPreparation = await inTenant(
                books.tenantId,
                async () => await service().resolvePreparation(books.fiscalYear.id, UNIFIED)
            );

            expect(preparation.findings.map(f => f.position)).toStrictEqual(['genInfo.company']);
            expect(preparation.content.company.name).toBe(COMPANY.name);
        });

        it('states an account mapped to a position of its own there', async () => {
            const books: EBilanzCaseBooks = await createBooks();
            const grossSales: string = 'is.netIncome.regular.operatingTC.grossTradingProfit.totalOutput.netSales.grossSales';
            const preparation: EBilanzPreparation = await inTenant(books.tenantId, async () => {
                await service().updateAccountMapping({
                    accountId: books.accounts.revenue.id,
                    position: `${grossSales}.generalRateVAT`
                });
                return await service().resolvePreparation(books.fiscalYear.id, UNIFIED);
            });

            expect(amountOf(preparation, `${grossSales}.generalRateVAT`)).toBe('10000.00');
            expect(amountOf(preparation, `${grossSales}.unknownVAT`)).toBeUndefined();
            expect(preparation.findings).toStrictEqual([]);
        });

        it('sums the statement of changes in fixed assets up to the book value, which needs to be that of the balance sheet', async () => {
            // 600.00 written off the office equipment, which the books do not tell from a disposal
            const books: EBilanzCaseBooks = await createBooks({ lines: [['rent', 'equipment', '600.00']] });
            const position: string = 'bs.ass.fixAss.tan.otherEquipm.misc';
            const prepare: (figures: [string, string][]) => Promise<EBilanzPreparation> = async figures => await inTenant(
                books.tenantId,
                async () => await service().resolvePreparation(books.fiscalYear.id, {
                    ...UNIFIED,
                    fixedAssets: [{ position, values: figures.map(([column, amount]) => ({ column, amount: new BigNumber(amount) })) }]
                })
            );
            const columnsOf: (preparation: EBilanzPreparation) => [string, string | undefined][] | undefined
                = preparation => preparation.content.fixedAssets
                    .find(f => f.position === position)?.values
                    .filter(v => v.amount != undefined)
                    .map(v => [v.column, v.amount?.toFixed(2)]);

            const unnamed: EBilanzPreparation = await prepare([]);
            expect(amountOf(unnamed, position)).toBe('2400.00');
            // and each position above it, whose book value is the sum of that of the rows below it
            expect(unnamed.findings.map(f => [
                f.position,
                f.message.includes('a book value of €3,000.00, which needs to equal the €2,400.00 of the balance sheet'),
                f.message.includes('for the positions below it')
            ])).toStrictEqual([
                ['bs.ass.fixAss', true, true],
                ['bs.ass.fixAss.tan', true, true],
                ['bs.ass.fixAss.tan.otherEquipm', true, true],
                [position, true, false]
            ]);
            // named by its label, with the amounts as a person reads them
            expect(unnamed.findings.at(-1)?.message).toBe(
                'The statement of changes in fixed assets of "andere Anlagen, Betriebs- und Geschäftsausstattung, nicht zuordenbar" '
                + 'ends with a book value of €3,000.00, which needs to equal the €2,400.00 of the balance sheet: '
                + 'enter the figures the books do not hold, such as the depreciation of the year.'
            );

            const depreciated: EBilanzPreparation = await prepare([['accDepr.DeprPeriod.regular', '600.00']]);
            expect(depreciated.findings).toStrictEqual([]);
            expect(columnsOf(depreciated)).toStrictEqual([
                ['all', '2400.00'],
                ['gross', '3000.00'],
                ['grossCost.beginning', '0.00'],
                ['gross.addition', '3000.00'],
                ['accDepr', '600.00'],
                ['accDepr.beginning', '0.00'],
                ['accDepr.DeprPeriod', '600.00'],
                ['accDepr.DeprPeriod.regular', '600.00']
            ]);

            // a sum named needs to be that of its parts, and the book value is made of it
            const summed: EBilanzPreparation = await prepare([['accDepr.DeprPeriod.regular', '600.00'], ['gross', '2400.00']]);
            expect(summed.findings
                .filter(f => f.position === position)
                .map(f => f.message.includes('which needs to equal the sum of the columns it adds up, €3,000.00.')))
                .toStrictEqual([true, false]);
            expect(summed.findings.find(f => f.position === position)?.message).toBe(
                'The statement of changes in fixed assets of "andere Anlagen, Betriebs- und Geschäftsausstattung, nicht zuordenbar" '
                + 'states €2,400.00 as "Anschaffungs- und Herstellungskosten zum Ende der Periode", '
                + 'which needs to equal the sum of the columns it adds up, €3,000.00.'
            );
            expect(columnsOf(summed)?.slice(0, 2)).toStrictEqual([['all', '1800.00'], ['gross', '2400.00']]);
        });

        it('states a row for each position above a row of the statement of changes in fixed assets, '
            + 'each column the sum of the rows below it', async () => {
            // 600.00 written off the office equipment
            const books: EBilanzCaseBooks = await createBooks({
                lines: [...FIXED_ASSETS_BOOKS.lines ?? [], ['rent', 'equipment', '600.00']]
            });
            const preparation: EBilanzPreparation = await inTenant(
                books.tenantId,
                async () => await service().resolvePreparation(books.fiscalYear.id, {
                    ...UNIFIED,
                    fixedAssets: [
                        {
                            position: 'bs.ass.fixAss.tan.otherEquipm.misc',
                            values: [{ column: 'accDepr.DeprPeriod.regular', amount: new BigNumber('600.00') }]
                        }
                    ]
                })
            );
            const columnOf: (position: string, column: string) => string | null | undefined
                = (position, column) => preparation.content.fixedAssets
                    .find(f => f.position === position)?.values.find(v => v.column === column)?.amount?.toFixed(2) ?? null;

            expect(preparation.findings).toStrictEqual([]);
            // in the order of the taxonomy, each group before the positions it sums, and each naming the row it is
            // summed into
            expect(preparation.content.fixedAssets.map(f => [f.position, f.parent])).toStrictEqual([
                ['bs.ass.fixAss', null],
                ['bs.ass.fixAss.intan', 'bs.ass.fixAss'],
                ['bs.ass.fixAss.intan.concessionBrands', 'bs.ass.fixAss.intan'],
                ['bs.ass.fixAss.tan', 'bs.ass.fixAss'],
                ['bs.ass.fixAss.tan.machinery', 'bs.ass.fixAss.tan'],
                ['bs.ass.fixAss.tan.otherEquipm', 'bs.ass.fixAss.tan'],
                ['bs.ass.fixAss.tan.otherEquipm.misc', 'bs.ass.fixAss.tan.otherEquipm']
            ]);
            expect(['bs.ass.fixAss', 'bs.ass.fixAss.intan', 'bs.ass.fixAss.tan', 'bs.ass.fixAss.tan.otherEquipm'].map(p => [
                columnOf(p, 'gross.addition'),
                columnOf(p, 'accDepr.DeprPeriod.regular'),
                columnOf(p, 'all')
            ])).toStrictEqual([
                ['6000.00', '600.00', '5400.00'],
                // NIL where no row below states the column
                ['1000.00', null, '1000.00'],
                ['5000.00', '600.00', '4400.00'],
                ['3000.00', '600.00', '2400.00']
            ]);
            // the book value of each row, the balance sheet's
            for (const row of preparation.content.fixedAssets) {
                expect([row.position, columnOf(row.position, 'all')]).toStrictEqual([row.position, amountOf(preparation, row.position)]);
            }
        });

        it('refuses the E-Bilanz of an open fiscal year, and a version of the taxonomy not registered', async () => {
            const open: EBilanzCaseBooks = await createBooks({ close: false });
            const closed: EBilanzCaseBooks = await createBooks();

            await expect(inTenant(open.tenantId, async () => await service().resolvePreparation(open.fiscalYear.id, UNIFIED)))
                .rejects.toThrow(ConflictError);
            await expect(inTenant(
                closed.tenantId,
                async () => await service().resolvePreparation(closed.fiscalYear.id, { ...UNIFIED, taxonomyVersion: '7.0' })
            )).rejects.toThrow(ConflictError);
        });

        it('sends it for real only after a test of the same content was accepted, and records each transmission', async () => {
            const books: EBilanzCaseBooks = await createBooks();
            await inTenant(books.tenantId, async () => {
                const preparation: EBilanzFiling = await service().prepare(books.fiscalYear.id, UNIFIED, 'ada');

                await expect(service().transmit(books.fiscalYear.id, { test: true }, 'ada')).rejects.toThrow('certificate');
                await service().updateCertificate(
                    { name: 'acme.pfx', mimeType: 'application/x-pkcs12', data: Buffer.from('pfx') },
                    'secret-pin',
                    'ada'
                );
                await expect(service().transmit(books.fiscalYear.id, { test: false }, 'ada')).rejects.toThrow('as a test');

                const sent: number = recordingTransmitter.transmissions.length;
                const startedTest: EBilanzFiling = await service().transmit(books.fiscalYear.id, { test: true }, 'ada');
                const test: EBilanzTransmissionSummary = await waitForTransmission(books.fiscalYear.id, startedTest.id);
                const startedReal: EBilanzFiling = await service().transmit(books.fiscalYear.id, { test: false }, 'ada');
                const real: EBilanzTransmissionSummary = await waitForTransmission(books.fiscalYear.id, startedReal.id);
                const state: EBilanzState = await service().resolveState(books.fiscalYear.id);

                // once each
                expect(recordingTransmitter.transmissions.slice(sent).map(t => [t.test, t.certificate.pin, t.certificate.file.toString()]))
                    .toStrictEqual([[true, 'secret-pin', 'pfx'], [false, 'secret-pin', 'pfx']]);
                expect([startedTest.kind, startedTest.status, startedTest.preparationId, startedTest.mayHaveBeenSent])
                    .toStrictEqual([EBilanzFilingKind.TEST_TRANSMISSION, EBilanzTransmissionStatus.TRANSMITTING, preparation.id, true]);
                expect([
                    test.test,
                    test.status,
                    test.startedBy,
                    test.result?.transmissionId,
                    test.result?.ticket,
                    test.result?.protocol == undefined
                ]).toStrictEqual([true, EBilanzTransmissionStatus.ACCEPTED, 'ada', startedTest.id, `ticket-${sent + 1}`, false]);
                expect([real.test, real.status, real.result?.kind])
                    .toStrictEqual([false, EBilanzTransmissionStatus.ACCEPTED, EBilanzFilingKind.TRANSMISSION]);
                expect(state.filings.map(f => [f.kind, f.status])).toStrictEqual([
                    [EBilanzFilingKind.PREPARED, null],
                    [EBilanzFilingKind.TEST_TRANSMISSION, EBilanzTransmissionStatus.TRANSMITTING],
                    [EBilanzFilingKind.TEST_TRANSMISSION, EBilanzTransmissionStatus.ACCEPTED],
                    [EBilanzFilingKind.TRANSMISSION, EBilanzTransmissionStatus.TRANSMITTING],
                    [EBilanzFilingKind.TRANSMISSION, EBilanzTransmissionStatus.ACCEPTED]
                ]);
                expect([state.filed, state.preparationCurrent, state.transmitterConfigured]).toStrictEqual([true, true, true]);
                await expect(service().transmit(books.fiscalYear.id, { test: false }, 'ada')).rejects.toThrow('filed');
                // archived: a record is never changed
                await expect(inject(repositoryTokenFor(EBilanzFiling)).updateById(startedReal.id, { ticket: 'changed' })).rejects.toThrow();
            });
        });

        it('refuses a second transmission and a filing by hand while one is running, and calls the transmitter once', async () => {
            const books: EBilanzCaseBooks = await createTransmittableBooks();
            let release: () => void = () => undefined;
            const gate: Promise<void> = new Promise(resolve => {
                release = resolve;
            });
            recordingTransmitter.answer = async () => {
                await gate;
                return await recordingTransmitter.resolveAccepted();
            };
            try {
                await inTenant(books.tenantId, async () => {
                    const sent: number = recordingTransmitter.transmissions.length;
                    const started: EBilanzFiling = await service().transmit(books.fiscalYear.id, { test: true }, 'ada');

                    await expect(service().transmit(books.fiscalYear.id, { test: true }, 'ada')).rejects.toThrow('being sent');
                    await expect(service().recordManualFiling(books.fiscalYear.id, PROTOCOL, 'ada')).rejects.toThrow('being sent');
                    // a transmission still running is no transmission whose instance stopped
                    expect((await service().resolveState(books.fiscalYear.id)).transmissions.map(t => t.status))
                        .toStrictEqual([EBilanzTransmissionStatus.TRANSMITTING]);
                    release();

                    expect((await waitForTransmission(books.fiscalYear.id, started.id)).status).toBe(EBilanzTransmissionStatus.ACCEPTED);
                    expect(recordingTransmitter.transmissions.length - sent).toBe(1);
                });
            }
            finally {
                recordingTransmitter.answerAccepted();
            }
        });

        it('records a failure the transmitter says sent nothing as not sent, and any other as one that may have been sent', async () => {
            const books: EBilanzCaseBooks = await createTransmittableBooks();
            try {
                await inTenant(books.tenantId, async () => {
                    // the error of a program the transmitter runs, with what it diagnosed
                    const runnerError: Error = Object.assign(
                        new Error('myebilanz stopped'),
                        { paragraphs: ['myebilanz stopped', 'The certificate could not be opened.'] }
                    );
                    recordingTransmitter.answer = async () => await Promise.reject(
                        new EBilanzNotSentError('Nothing was sent.', { cause: runnerError })
                    );
                    const notSent: EBilanzTransmissionSummary = await waitForTransmission(
                        books.fiscalYear.id,
                        (await service().transmit(books.fiscalYear.id, { test: true }, 'ada')).id
                    );
                    expect([notSent.status, notSent.mayHaveBeenSent, notSent.result?.error?.name, notSent.result?.error?.message])
                        .toStrictEqual([EBilanzTransmissionStatus.FAILED, false, 'EBilanzNotSentError', 'Nothing was sent.']);
                    expect(notSent.result?.error?.paragraphs).toContain('    The certificate could not be opened.');

                    // nothing was sent, so it is sent again, and fails without saying
                    recordingTransmitter.answer = async () => await Promise.reject(runnerError);
                    const failed: EBilanzTransmissionSummary = await waitForTransmission(
                        books.fiscalYear.id,
                        (await service().transmit(books.fiscalYear.id, { test: true }, 'ada')).id
                    );
                    expect([failed.status, failed.mayHaveBeenSent, failed.result?.error?.paragraphs])
                        .toStrictEqual([
                            EBilanzTransmissionStatus.FAILED,
                            true,
                            ['myebilanz stopped', 'The certificate could not be opened.']
                        ]);
                    // it may have been sent, so it is not sent again until a person settles it
                    await expect(service().transmit(books.fiscalYear.id, { test: true }, 'ada')).rejects.toThrow('not known');

                    const settled: EBilanzFiling[] = await service().recordNotReceived(books.fiscalYear.id, 'grace');
                    expect(settled.map(f => [f.status, f.transmissionId, f.mayHaveBeenSent, f.createdBy]))
                        .toStrictEqual([[EBilanzTransmissionStatus.NOT_RECEIVED, failed.id, false, 'grace']]);
                    await expect(service().recordNotReceived(books.fiscalYear.id, 'grace')).rejects.toThrow('not known');
                    recordingTransmitter.answerAccepted();
                    const again: EBilanzFiling = await service().transmit(books.fiscalYear.id, { test: true }, 'ada');
                    expect((await waitForTransmission(books.fiscalYear.id, again.id)).status).toBe(EBilanzTransmissionStatus.ACCEPTED);
                });
            }
            finally {
                recordingTransmitter.answerAccepted();
            }
        });

        it('concludes a transmission whose instance stopped as unknown, never sends it again, and leaves one running alone', async () => {
            const books: EBilanzTransmittableBooks = await createTransmittableBooks();
            await inTenant(books.tenantId, async () => {
                const preparation: EBilanzFiling = books.preparation;
                // what an instance that stopped while sending leaves: the start, and no lease
                const filings: Repository<EBilanzFiling, EBilanzFilingCreateData> = inject(repositoryTokenFor(EBilanzFiling));
                const started: EBilanzFiling = await filings.create({
                    fiscalYearId: books.fiscalYear.id,
                    end: books.fiscalYear.end,
                    kind: EBilanzFilingKind.TRANSMISSION,
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
                    createdBy: 'ada',
                    createdAt: new Date(),
                    retainUntil: new Date('2040-01-01T00:00:00.000Z')
                });
                const sent: number = recordingTransmitter.transmissions.length;

                // another instance still sending it holds the lease
                const whileHeld: EBilanzState | undefined = await inject(ZIBRI_DI_TOKENS.LEASE_SERVICE).withLease(
                    { key: `e-bilanz:transmission:${books.fiscalYear.id}`, leaseInMs: Ms.MINUTE, mode: 'skip' },
                    async () => await service().resolveState(books.fiscalYear.id)
                );
                expect(whileHeld?.transmissions.map(t => t.status)).toStrictEqual([EBilanzTransmissionStatus.TRANSMITTING]);

                const state: EBilanzState = await service().resolveState(books.fiscalYear.id);
                expect(state.transmissions.map(t => [t.id, t.status, t.mayHaveBeenSent, t.result?.error?.name]))
                    .toStrictEqual([[started.id, EBilanzTransmissionStatus.UNKNOWN, true, 'EBilanzTransmissionStoppedError']]);
                // concluded once
                expect((await service().resolveState(books.fiscalYear.id)).filings.filter(f => f.transmissionId === started.id))
                    .toHaveLength(1);
                await expect(service().transmit(books.fiscalYear.id, { test: false }, 'ada')).rejects.toThrow('not known');
                expect(recordingTransmitter.transmissions.length).toBe(sent);

                // filed by hand, which settles it
                await service().recordManualFiling(books.fiscalYear.id, PROTOCOL, 'ada');
                await expect(service().transmit(books.fiscalYear.id, { test: false }, 'ada')).rejects.toThrow('filed');
                expect(recordingTransmitter.transmissions.length).toBe(sent);
            });
        });

        it('refuses to send a preparation the books state otherwise now, and records a filing by hand', async () => {
            const books: EBilanzCaseBooks = await createBooks();
            await inTenant(books.tenantId, async () => {
                await service().prepare(books.fiscalYear.id, UNIFIED, 'ada');
                await service().updateAccountMapping({
                    accountId: books.accounts.rent.id,
                    position: 'is.netIncome.regular.operatingTC.otherCost.leaseFix.misc'
                });

                expect((await service().resolveState(books.fiscalYear.id)).preparationCurrent).toBe(false);
                await expect(service().recordManualFiling(books.fiscalYear.id, PROTOCOL, 'ada'))
                    .rejects.toThrow('prepared again');

                await service().prepare(books.fiscalYear.id, UNIFIED, 'ada');
                const filing: EBilanzFiling = await service().recordManualFiling(books.fiscalYear.id, PROTOCOL, 'ada');

                expect([filing.kind, filing.createdBy]).toStrictEqual([EBilanzFilingKind.MANUAL_FILING, 'ada']);
                expect((await service().resolveState(books.fiscalYear.id)).filed).toBe(true);
            });
        });

        it('reopens a fiscal year whose E-Bilanz is not filed, and prepares it again with the corrected figures', async () => {
            const books: EBilanzTransmittableBooks = await createTransmittableBooks();
            await inTenant(books.tenantId, async () => {
                const before: EBilanzPreparation = await service().resolvePreparation(books.fiscalYear.id, UNIFIED);

                await journal().reopenFiscalYear(books.fiscalYear.id, { reason: 'Rent booked twice', createdBy: 'ada' });

                // stated otherwise than prepared: open, and the preparation sends nothing
                expect((await service().resolveState(books.fiscalYear.id)).preparationCurrent).toBe(false);
                await expect(service().prepare(books.fiscalYear.id, UNIFIED, 'ada')).rejects.toThrow('needs to be closed');
                await expect(service().transmit(books.fiscalYear.id, { test: true }, 'ada')).rejects.toThrow('needs to be closed');
                await journal().post({
                    documentDate: day('2026-12-30'),
                    postingDate: day('2026-12-30'),
                    documentReference: 'G-1',
                    text: 'Rent booked twice',
                    lines: [
                        { accountId: books.accounts.bank.id, debit: new BigNumber('200.00'), credit: null },
                        { accountId: books.accounts.rent.id, debit: null, credit: new BigNumber('200.00') }
                    ]
                });
                await journal().closeFiscalYear(books.fiscalYear.id, { resultAccountId: books.accounts.result.id });

                // closed again, the preparation of before states another E-Bilanz than the books now
                expect((await service().resolveState(books.fiscalYear.id)).preparationCurrent).toBe(false);
                await expect(service().transmit(books.fiscalYear.id, { test: true }, 'ada')).rejects.toThrow('prepared again');
                const after: EBilanzFiling = await service().prepare(books.fiscalYear.id, UNIFIED, 'ada');
                const corrected: EBilanzPreparation = { content: after.content ?? before.content, findings: [] };
                expect([amountOf(before, 'is.netIncome'), amountOf(corrected, 'is.netIncome')]).toStrictEqual(['8800.00', '9000.00']);
                expect([amountOf(before, 'bs.eqLiab.equity.netIncome'), amountOf(corrected, 'bs.eqLiab.equity.netIncome')])
                    .toStrictEqual(['8800.00', '9000.00']);
                expect(after.contentHash).not.toBe(books.preparation.contentHash);
                // the record of the first preparation stays as it was archived
                expect((await service().resolveState(books.fiscalYear.id)).filings.map(f => f.id))
                    .toStrictEqual([books.preparation.id, after.id]);
            });
        });

        it('refuses to reopen a fiscal year whose E-Bilanz is filed unless for a correction, '
            + 'and one whose transmission is not settled', async () => {
            const filed: EBilanzTransmittableBooks = await createTransmittableBooks();
            await inTenant(filed.tenantId, async () => {
                await expect(journal().reopenFiscalYear(filed.fiscalYear.id, { reason: 'Correction', forCorrection: true }))
                    .rejects.toThrow('nothing to correct');
                await service().recordManualFiling(filed.fiscalYear.id, PROTOCOL, 'ada');

                await expect(journal().reopenFiscalYear(filed.fiscalYear.id, { reason: 'Correction' }))
                    .rejects.toThrow('only to correct it, with forCorrection');
                expect((await journal().reopenFiscalYear(
                    filed.fiscalYear.id,
                    { reason: 'Correction', forCorrection: true }
                )).fiscalYear.reopenings).toBe(1);
            });

            const running: EBilanzTransmittableBooks = await createTransmittableBooks();
            let release: () => void = () => undefined;
            const gate: Promise<void> = new Promise(resolve => {
                release = resolve;
            });
            recordingTransmitter.answer = async () => {
                await gate;
                return await Promise.reject(new Error('myebilanz stopped'));
            };
            try {
                await inTenant(running.tenantId, async () => {
                    const started: EBilanzFiling = await service().transmit(running.fiscalYear.id, { test: true }, 'ada');
                    await expect(journal().reopenFiscalYear(running.fiscalYear.id, { reason: 'Correction' })).rejects.toThrow('being sent');
                    release();
                    // failed, and may have been sent
                    expect((await waitForTransmission(running.fiscalYear.id, started.id)).status).toBe(EBilanzTransmissionStatus.FAILED);
                    await expect(journal().reopenFiscalYear(running.fiscalYear.id, { reason: 'Correction' }))
                        .rejects.toThrow('Settle it before');

                    await service().recordNotReceived(running.fiscalYear.id, 'ada');
                    expect((await journal().reopenFiscalYear(running.fiscalYear.id, { reason: 'Correction' })).fiscalYear.closedAt)
                        .toBeNull();
                });
            }
            finally {
                recordingTransmitter.answerAccepted();
            }
        });

        it('prepares a correction of an accepted E-Bilanz with the status it is given, naming the filing it corrects, '
            + 'and sends it as a test first', async () => {
            const books: EBilanzTransmittableBooks = await createTransmittableBooks();
            await inTenant(books.tenantId, async () => {
                const send: (test: boolean) => Promise<EBilanzTransmissionSummary> = async test => await waitForTransmission(
                    books.fiscalYear.id,
                    (await service().transmit(books.fiscalYear.id, { test }, 'ada')).id
                );
                // a status correcting a filing, while nothing is filed
                await expect(service().prepare(books.fiscalYear.id, { ...UNIFIED, revisionStatus: EBilanzRevisionStatus.CORRECTED }, 'ada'))
                    .rejects.toThrow('is not filed, so it is prepared without a revisionStatus');
                expect((await send(true)).status).toBe(EBilanzTransmissionStatus.ACCEPTED);
                const original: EBilanzTransmissionSummary = await send(false);
                expect(original.status).toBe(EBilanzTransmissionStatus.ACCEPTED);

                // filed: a preparation corrects it, and says how
                await expect(service().prepare(books.fiscalYear.id, UNIFIED, 'ada')).rejects.toThrow('needs its revisionStatus');
                await expect(service().prepare(books.fiscalYear.id, { ...UNIFIED, revisionStatus: EBilanzRevisionStatus.ORIGINAL }, 'ada'))
                    .rejects.toThrow('needs its revisionStatus');
                await service().updateAccountMapping({
                    accountId: books.accounts.rent.id,
                    position: 'is.netIncome.regular.operatingTC.otherCost.leaseFix.misc'
                });
                const corrected: EBilanzFiling = await service().prepare(
                    books.fiscalYear.id,
                    { ...UNIFIED, revisionStatus: EBilanzRevisionStatus.CORRECTED },
                    'ada'
                );

                expect([corrected.correctsFilingId, corrected.input?.revisionStatus])
                    .toStrictEqual([original.result?.id, EBilanzRevisionStatus.CORRECTED]);
                expect(corrected.content?.fields.find(f => f.name === 'genInfo.report.id.revisionStatus')?.value)
                    .toBe(EBilanzRevisionStatus.CORRECTED);
                expect(books.preparation.correctsFilingId).toBeNull();
                // its content was not sent as a test yet, and once filed it is not sent again
                await expect(service().transmit(books.fiscalYear.id, { test: false }, 'ada')).rejects.toThrow('as a test');
                expect((await send(true)).status).toBe(EBilanzTransmissionStatus.ACCEPTED);
                expect((await send(false)).result?.preparationId).toBe(corrected.id);
                await expect(service().transmit(books.fiscalYear.id, { test: false }, 'ada')).rejects.toThrow('filed as prepared');
                await expect(service().transmit(books.fiscalYear.id, { test: true }, 'ada')).rejects.toThrow('filed as prepared');
            });
        });

        it('asks for the E-Bilanz once the fiscal year is closed, with its deadline, until it is filed', async () => {
            const open: EBilanzCaseBooks = await createBooks({ close: false });
            const books: EBilanzCaseBooks = await createBooks();

            expect(await inTenant(open.tenantId, async () => await journal().resolveObligations(open.fiscalYear.id))).toStrictEqual([]);
            const before: BookkeepingObligation[] = await inTenant(
                books.tenantId,
                async () => await journal().resolveObligations(books.fiscalYear.id)
            );
            // 2027-07-31 is a Saturday, § 108 (3) AO
            expect(before.map(o => [o.conformance, o.dueOn.toISOString(), o.fulfilledAt]))
                .toStrictEqual([['e-bilanz', '2027-08-02T00:00:00.000Z', null]]);

            const after: BookkeepingObligation[] = await inTenant(books.tenantId, async () => {
                const company: GermanBookkeepingCompany = { ...COMPANY, taxAdvisor: true };
                await journal().updateSettings({ company });
                await service().prepare(books.fiscalYear.id, UNIFIED, 'ada');
                await service().recordManualFiling(books.fiscalYear.id, PROTOCOL, 'ada');
                return await journal().resolveObligations(books.fiscalYear.id);
            });
            expect(after.map(o => [o.dueOn.toISOString(), o.fulfilledAt != undefined])).toStrictEqual([['2028-02-29T00:00:00.000Z', true]]);
        });
    });
}