/* eslint-disable cspell/spellchecker */
import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { companyInfoProvider } from '../../__testing__/mocks/company-info-provider.function';
import { runApplicationClockAhead } from '../../__testing__/run-application-clock-ahead.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { DataSource } from '../../data-source/decorators/data-source.decorator';
import { Repository } from '../../data-source/repository/repository';
import { RepositoryClass } from '../../data-source/repository/repository-class.type';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { getZonedDate } from '../../localization/get-zoned-date.function';
import { ZonedDate } from '../../localization/models/zoned-date.model';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { ZibriInvoicingPlugin } from './invoicing.plugin';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from './invoicing.tokens';
import { CompanyInfo } from './models/company-info.model';
import { InvoiceAddress } from './models/invoice-address.model';
import { InvoiceRecipientAbbreviation } from './models/invoice-recipient-abbreviation.model';
import { Invoice } from './models/invoice.model';
import { InvoicingOptionsInput } from './models/invoicing-options-input.model';
import { NumberInvoices } from './models/number-invoices.model';
import { InvoiceCancellationServiceInterface } from './services/invoice-cancellation-service.interface';
import { InvoiceNumberService } from './services/invoice-number.service';

// the formats invoice numbers are drawn in: the application's, and the one a tenant sets for itself. In memory;
// whether a number drawn in a transaction that is rolled back leaves a gap is invoice-number.service.container.test.ts's

/**
 * A team numbering with the format of the application.
 */
const DEFAULT_TEAM: string = UUIDUtilities.generate();

/**
 * A team numbering all its invoices in one sequence a year.
 */
const SEQUENCE_TEAM: string = UUIDUtilities.generate();

/**
 * A team numbering its invoices by month, and its credit notes in a series of their own.
 */
const SERIES_TEAM: string = UUIDUtilities.generate();

/**
 * A team that changes its format, to the one in `changingFormat`.
 */
const CHANGING_TEAM: string = UUIDUtilities.generate();

/**
 * The format of the team that changes it.
 */
let changingFormat: string = '{year}-{counter}';

/**
 * The company of a team, with its own formats.
 * @param tenantId - The team.
 * @returns The company.
 */
function companyOf(tenantId: string): CompanyInfo {
    const company: CompanyInfo = {
        name: 'Example Company',
        fullName: 'Example Company LLC',
        email: 'info@example-company.com',
        phone: '12345 67890123',
        timezone: 'Europe/Berlin',
        address: { street: 'Example street', number: '1b', postcode: '12345', city: 'Example city', countryId: 'DE' }
    };
    switch (tenantId) {
        case SEQUENCE_TEAM: {
            return { ...company, numberFormat: '{year}-{counter}' };
        }
        case SERIES_TEAM: {
            return { ...company, numberFormat: 'INV-{yy}{month}-{counter}', creditNoteNumberFormat: 'CN-{year}-{counter}' };
        }
        case CHANGING_TEAM: {
            return { ...company, numberFormat: changingFormat };
        }
        default: {
            return company;
        }
    }
}

/**
 * A company customer.
 * @param companyName - The name of the company.
 * @returns Its address.
 */
function customerNamed(companyName: string): InvoiceAddress {
    return {
        formOfAddress: '',
        firstName: '',
        lastName: '',
        street: 'Great Street',
        number: '42',
        postcode: '12345',
        city: 'Great City',
        company: true,
        companyName,
        countryId: 'DE'
    };
}

const siemens: InvoiceAddress = customerNamed('Siemens AG');
const bosch: InvoiceAddress = customerNamed('Robert Bosch GmbH');

/**
 * Runs the given work in a team.
 * @param tenantId - The team.
 * @param fn - The work.
 * @returns What the work answered.
 */
async function inTeam<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, fn);
}

/**
 * Draws an invoice number in a team.
 * @param tenantId - The team.
 * @param recipientId - The recipient.
 * @param address - Their address.
 * @returns The number.
 */
async function drawNumber(tenantId: string, recipientId: string = 'siemens', address: InvoiceAddress = siemens): Promise<string> {
    return await inTeam(tenantId, async () => await inject(InvoiceNumberService).generateInvoiceNumber(recipientId, address, undefined));
}

/**
 * Issues an invoice to Siemens in a team, numbered by the plugin.
 * @param tenantId - The team.
 * @returns The invoice.
 */
async function issueInvoice(tenantId: string): Promise<Invoice> {
    const number: string = await drawNumber(tenantId);
    const invoices: Repository<Invoice, OmitStrict<Invoice, 'id' | 'tenantId'>> = inject(repositoryTokenFor(Invoice));
    return await inTeam(tenantId, async () => await invoices.create({
        number,
        currency: 'EUR',
        items: [{ name: 'Consulting', amount: 1, amountUnit: { code: 'HUR', displayName: 'Hours' }, vat: { categoryCode: 'S', rate: 19 }, price: 100 }],
        date: new Date(),
        performanceDate: new Date(),
        dueDate: new Date(),
        customerAddressData: siemens,
        textBeforeItems: [],
        textAfterItems: [],
        issuedAt: new Date()
    }));
}

/**
 * Starts an application numbering in the given formats, and shuts it down again.
 * @param options - The invoicing options.
 */
async function startAndStopWith(options: InvoicingOptionsInput): Promise<void> {
    // a data source of its own each time, allowed to be orphaned: the next start does without it
    @DataSource({ allowOrphan: true })
    class NumberFormatDataSource extends InMemoryDataSource {
        override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, Invoice, NumberInvoices, InvoiceRecipientAbbreviation];
        override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
    }
    const started: StartedTestServer = await startTestServer({
        dataSources: [NumberFormatDataSource],
        plugins: [new ZibriInvoicingPlugin()],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: options }),
            companyInfoProvider(companyOf)
        ]
    });
    await started.shutdown();
}

// first, before a server of the file declares a data source every later start would be refused for
describe('a number format of the application', () => {
    it('is refused at startup without {counter}, naming it', async () => {
        await expect(startAndStopWith({ numberFormat: '{year}-{recipient}' })).rejects.toThrow(
            'The numberFormat of the invoicing options, "{year}-{recipient}", needs to name {counter} once.'
        );
    }, TestTimeouts.inMemory.start);

    it('is refused at startup with a token it does not know', async () => {
        await expect(startAndStopWith({ numberFormat: '{year}-{day}-{counter}' })).rejects.toThrow(
            'The numberFormat of the invoicing options, "{year}-{day}-{counter}", names the unknown token {day}. '
            + 'It can name {year}, {yy}, {month}, {recipient}, {counter}.'
        );
        await expect(startAndStopWith({ creditNoteNumberFormat: '{recipient}-{counter}' })).rejects.toThrow(
            'The creditNoteNumberFormat of the invoicing options, "{recipient}-{counter}", names the unknown token {recipient}. '
            + 'It can name {invoice}, {year}, {yy}, {month}, {counter}.'
        );
    }, TestTimeouts.inMemory.start);
});

describe('numbering in a format', () => {
    let server: StartedTestServer | undefined;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, Invoice, NumberInvoices, InvoiceRecipientAbbreviation], repositories: defaultTestServerRepositories })],
            plugins: [new ZibriInvoicingPlugin()],
            providers: [...defaultTestServerProviders, companyInfoProvider(companyOf)]
        });
    }, TestTimeouts.inMemory.start);

    afterEach(() => {
        jest.useRealTimers();
    });

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    /**
     * Now in Berlin, where the companies of the tests keep their books.
     * @returns The date.
     */
    function nowInBerlin(): ZonedDate {
        return getZonedDate(new Date(), 'Europe/Berlin');
    }

    it('draws the numbers of the default format, a sequence per recipient and year', async () => {
        const year: number = nowInBerlin().year;

        expect([await drawNumber(DEFAULT_TEAM), await drawNumber(DEFAULT_TEAM), await drawNumber(DEFAULT_TEAM, 'bosch', bosch)])
            .toEqual([`${year}-SIEMEN-0001`, `${year}-SIEMEN-0002`, `${year}-ROBERT-0001`]);
    });

    it('counts {year}-{counter} across recipients, and starts again with the year of the company', async () => {
        const year: number = nowInBerlin().year;

        const numbers: string[] = [await drawNumber(SEQUENCE_TEAM), await drawNumber(SEQUENCE_TEAM, 'bosch', bosch)];
        // 00:30 on New Year's Day in Berlin
        runApplicationClockAhead(Date.UTC(year, 11, 31, 23, 30) - Date.now());
        const nextYear: string = await drawNumber(SEQUENCE_TEAM);

        expect(numbers).toEqual([`${year}-0001`, `${year}-0002`]);
        expect(nextYear).toBe(`${year + 1}-0001`);
    });

    it('claims no name abbreviation for a format without {recipient}', async () => {
        await drawNumber(SEQUENCE_TEAM, 'abbreviation-free', customerNamed('Initech'));

        const abbreviations: InvoiceRecipientAbbreviation[] = await inTeam(
            SEQUENCE_TEAM,
            async () => await inject(repositoryTokenFor(InvoiceRecipientAbbreviation)).findAll()
        );
        expect(abbreviations).toEqual([]);
    });

    it('gives every number drawn at the same moment its own', async () => {
        const numbers: string[] = await Promise.all([drawNumber(SEQUENCE_TEAM), drawNumber(SEQUENCE_TEAM), drawNumber(SEQUENCE_TEAM)]);

        expect(new Set(numbers).size).toBe(3);
    });

    it('keeps TEMP before a temporary number, drawing nothing', async () => {
        const temporary: string = await inTeam(SERIES_TEAM, async () => await inject(InvoiceNumberService).generateTemporaryInvoiceNumber('siemens', siemens));
        const number: string = await drawNumber(SERIES_TEAM);

        expect(temporary).toBe(`TEMP-${number}`);
    });

    it('numbers credit notes of their own format on their own', async () => {
        const date: ZonedDate = nowInBerlin();
        const yyMonth: string = `${String(date.year % 100).padStart(2, '0')}${String(date.month + 1).padStart(2, '0')}`;
        const cancellations: InvoiceCancellationServiceInterface<Invoice> = inject<InvoiceCancellationServiceInterface<Invoice>>(
            ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CANCELLATION_SERVICE
        );

        const first: Invoice = await issueInvoice(SERIES_TEAM);
        const second: Invoice = await issueInvoice(SERIES_TEAM);
        const creditNotes: Invoice[] = [
            await inTeam(SERIES_TEAM, async () => await cancellations.cancelInvoice(second.id)),
            await inTeam(SERIES_TEAM, async () => await cancellations.cancelInvoice(first.id))
        ];
        const third: Invoice = await issueInvoice(SERIES_TEAM);

        expect([first.number, second.number, third.number]).toEqual([`INV-${yyMonth}-0002`, `INV-${yyMonth}-0003`, `INV-${yyMonth}-0004`]);
        expect(creditNotes.map(c => c.number)).toEqual([`CN-${date.year}-1`, `CN-${date.year}-2`]);
        // kept under year 0 and the scope, apart from the counters an instance of 3.2 draws from by year and recipient
        const counters: NumberInvoices[] = await inTeam(SERIES_TEAM, async () => await inject(repositoryTokenFor(NumberInvoices)).findAll());
        expect(counters.map(c => [c.year, c.recipientId, c.scope, c.number]).sort()).toEqual([
            [0, `CN-${date.year}-{counter}`, `CN-${date.year}-{counter}`, 2],
            [0, `INV-${yyMonth}-{counter}`, `INV-${yyMonth}-{counter}`, 4]
        ]);
    });

    it('draws from the counter an instance of 3.2 draws from for the default format, by year and recipient', async () => {
        const year: number = nowInBerlin().year;
        const counters: Repository<NumberInvoices, OmitStrict<NumberInvoices, 'id' | 'tenantId'>> = inject(repositoryTokenFor(NumberInvoices));
        /**
         * Draws a number the way an instance of 3.2 does.
         * @param recipientId - The recipient.
         * @returns The count.
         */
        async function drawAsThreeTwo(recipientId: string): Promise<number> {
            const counter: NumberInvoices = await inTeam(DEFAULT_TEAM, async () => await counters.upsert(
                { year, recipientId },
                { year, recipientId, number: 1 },
                { number: { increment: 1 } }
            ));
            return counter.number;
        }
        const initech: InvoiceAddress = customerNamed('Initech');

        const first: string = await drawNumber(DEFAULT_TEAM, 'initech', initech);
        const ofThreeTwo: number = await drawAsThreeTwo('initech');
        const next: string = await drawNumber(DEFAULT_TEAM, 'initech', initech);
        // the first number of a recipient drawn by 3.2, which creates the counter without a scope
        const createdByThreeTwo: number = await drawAsThreeTwo('umbrella');
        const afterIt: string = await drawNumber(DEFAULT_TEAM, 'umbrella', customerNamed('Umbrella Corp'));

        expect([first, ofThreeTwo, next]).toEqual([`${year}-INITEC-0001`, 2, `${year}-INITEC-0003`]);
        expect([createdByThreeTwo, afterIt]).toEqual([1, `${year}-UMBREL-0002`]);
    });

    it('goes on counting a scope when a team changes its format and changes it back', async () => {
        const year: number = nowInBerlin().year;

        const before: string[] = [await drawNumber(CHANGING_TEAM), await drawNumber(CHANGING_TEAM)];
        changingFormat = 'R{year}-{counter}';
        const changed: string = await drawNumber(CHANGING_TEAM);
        changingFormat = '{year}-{counter}';
        const back: string = await drawNumber(CHANGING_TEAM);

        expect([...before, changed, back]).toEqual([`${year}-0001`, `${year}-0002`, `R${year}-0001`, `${year}-0003`]);
    });

    it('refuses a format of a team without {counter} when it draws a number', async () => {
        changingFormat = '{year}';

        await expect(drawNumber(CHANGING_TEAM)).rejects.toThrow(
            `The numberFormat of the company of the tenant ${CHANGING_TEAM}, "{year}", needs to name {counter} once.`
        );
        changingFormat = '{year}-{counter}';
    });

    it('goes on with a counter stored before numbers had a format, in the default format', async () => {
        const year: number = nowInBerlin().year;
        await inTeam(DEFAULT_TEAM, async () => {
            await inject(repositoryTokenFor(NumberInvoices)).create({ recipientId: 'acme', year, number: 41 });
            await inject(repositoryTokenFor(InvoiceRecipientAbbreviation)).create({ recipientId: 'acme', nameAbbreviation: 'ACME' });
        });

        if (server == undefined) {
            throw new Error('the server did not start');
        }
        // what the application does when it starts
        await inject(InvoiceNumberService).onAppInit(server['app']);
        const number: string = await drawNumber(DEFAULT_TEAM, 'acme', customerNamed('Acme Corporation'));

        expect(number).toBe(`${year}-ACME-0042`);
        const counters: NumberInvoices[] = await inTeam(
            DEFAULT_TEAM,
            async () => await inject(repositoryTokenFor(NumberInvoices)).findAll({ where: { recipientId: 'acme' } })
        );
        expect(counters.map(c => [c.scope, c.number])).toEqual([[`${year}-ACME-{counter}`, 42]]);
    });
});