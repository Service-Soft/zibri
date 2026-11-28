import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { TestTimeouts } from '../../__testing__/constants';
import { companyInfoProvider } from '../../__testing__/mocks/company-info-provider.function';
import { queryPostgres } from '../../__testing__/query-postgres.function';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { PostgresDataSource } from '../../data-source/data-sources/postgres/postgres-data-source.model';
import { MigratedEntityUtilities } from '../../data-source/migration/migrated-entity.utilities';
import { MigrationEntity } from '../../data-source/migration/migration-entity.model';
import { Migration } from '../../data-source/migration/migration.model';
import { Repository } from '../../data-source/repository/repository';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { getZonedDate } from '../../localization/get-zoned-date.function';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { SemVerVersion } from '../../utilities/sem-ver.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { ZibriInvoicingPlugin } from './invoicing.plugin';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from './invoicing.tokens';
import { InvoiceAddress } from './models/invoice-address.model';
import { InvoiceItem } from './models/invoice-item.model';
import { InvoiceRecipientAbbreviation } from './models/invoice-recipient-abbreviation.model';
import { InvoiceType } from './models/invoice-type.enum';
import { Invoice } from './models/invoice.model';
import { NumberInvoices } from './models/number-invoices.model';
import { InvoiceCancellationServiceInterface } from './services/invoice-cancellation-service.interface';
import { InvoiceNumberService } from './services/invoice-number.service';

const INVOICES: string = MigratedEntityUtilities.resolveTableName(Invoice);
const COUNTERS: string = MigratedEntityUtilities.resolveTableName(NumberInvoices);
const ABBREVIATIONS: string = MigratedEntityUtilities.resolveTableName(InvoiceRecipientAbbreviation);

/**
 * The tenant whose invoices were stored before the upgrade.
 */
const TEAM: string = UUIDUtilities.generate();

/**
 * The invoice stored before the upgrade.
 */
const INVOICE_ID: string = UUIDUtilities.generate();

/**
 * The year the invoices are numbered in, in the time zone of the company.
 */
const YEAR: number = getZonedDate(new Date(), 'Europe/Berlin').year;

const siemens: InvoiceAddress = {
    formOfAddress: '',
    firstName: '',
    lastName: '',
    street: 'Great Street',
    number: '42',
    postcode: '12345',
    city: 'Great City',
    company: true,
    companyName: 'Siemens AG',
    countryId: 'DE'
};

const items: InvoiceItem[] = [{ name: 'Consulting', amount: 1, amountUnit: { code: 'HUR', displayName: 'Hours' }, vat: { categoryCode: 'S', rate: 19 }, price: 100 }];

/**
 * The migrations of an application of 3.2: the invoices as 3.2 stored them, without a type, references or an
 * issue date, and their counters without a scope, with the 41st invoice of a recipient this year.
 */
@Injectable()
class InvoicingOfThreeTwoMigration extends Migration {
    version: SemVerVersion = '0.0.1';

    constructor() {
        super(getDataSourceClass());
    }

    override async up(transaction: Transaction): Promise<void> {
        // the migration table is the one the data source creates itself, before any migration runs
        for (const entity of [...defaultTestServerEntities.filter(e => e !== MigrationEntity), Invoice, NumberInvoices, InvoiceRecipientAbbreviation]) {
            await this.dataSource.createEntity({ entity, properties: 'resolveFromEntity', transaction });
        }
        for (const propertyKey of ['type', 'precedingInvoices', 'issuedAt']) {
            await this.dataSource.removePropertyFromEntity({ entity: Invoice, propertyKey, transaction });
        }
        await this.dataSource.removePropertyFromEntity({ entity: NumberInvoices, propertyKey: 'scope', transaction });
        const dataSource: PostgresDataSource = inject(getDataSourceClass());
        await queryPostgres(
            dataSource,
            `INSERT INTO "${INVOICES}" ("id", "tenantId", "number", "items", "date", "performanceDate", "dueDate", "customerAddressData", `
            + '"textBeforeItems", "textAfterItems", "currency") VALUES ($1, $2, $3, $4, $5, $5, $5, $6, $7, $7, \'EUR\')',
            [INVOICE_ID, TEAM, `${YEAR}-SIEMEN-0041`, JSON.stringify(items), new Date(), JSON.stringify(siemens), []],
            transaction
        );
        await queryPostgres(
            dataSource,
            `INSERT INTO "${COUNTERS}" ("id", "tenantId", "recipientId", "number", "year") VALUES ($1, $2, 'siemens', 41, $3)`,
            [UUIDUtilities.generate(), TEAM, YEAR],
            transaction
        );
        await queryPostgres(
            dataSource,
            `INSERT INTO "${ABBREVIATIONS}" ("id", "tenantId", "recipientId", "nameAbbreviation") VALUES ($1, $2, 'siemens', 'SIEMEN')`,
            [UUIDUtilities.generate(), TEAM],
            transaction
        );
    }

    // eslint-disable-next-line typescript/require-await
    override async down(): Promise<void> {
        throw new Error('Not needed for this test.');
    }
}

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, Invoice, NumberInvoices, InvoiceRecipientAbbreviation],
    repositories: defaultTestServerRepositories,
    schemaManagement: 'migrations',
    migrations: [InvoicingOfThreeTwoMigration]
});

/**
 * The data source the migration runs in. Read through a function, because the data source names the
 * migration and so is built after it.
 * @returns The data source.
 */
function getDataSourceClass(): Newable<PostgresDataSource> {
    return dataSourceClass;
}

/**
 * Runs the given work in the tenant whose invoices were stored before the upgrade.
 * @param fn - The work.
 * @returns What the work answered.
 */
async function inTeam<T>(fn: () => Promise<T>): Promise<T> {
    return await inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(TEAM, fn);
}

// an application of 3.2 upgrading, whose schema its migrations manage: it writes no migration of its own
describe('the invoices and counters of an application of 3.2, after the upgrade', () => {
    let server: StartedTestServer | undefined;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            plugins: [new ZibriInvoicingPlugin()],
            providers: [
                ...defaultTestServerProviders,
                companyInfoProvider(() => ({
                    name: 'Example Company',
                    fullName: 'Example Company LLC',
                    email: 'info@example-company.com',
                    phone: '12345 67890123',
                    timezone: 'Europe/Berlin',
                    address: { street: 'Example street', number: '1b', postcode: '12345', city: 'Example city', countryId: 'DE' }
                }))
            ]
        });
    }, TestTimeouts.postgres.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.postgres.shutdown);

    it('reads an invoice stored before as an invoice, with no references, issued on its date', async () => {
        const invoice: Invoice = await inTeam(async () => await inject(repositoryTokenFor(Invoice)).findById(INVOICE_ID));
        const columns: Record<string, unknown>[] = await queryPostgres(
            inject(dataSourceClass),
            'SELECT column_name AS "name", column_default AS "default" FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1',
            [INVOICES]
        );

        // given its date at the start, as its final number says it was issued
        expect([invoice.type, invoice.precedingInvoices, invoice.issuedAt]).toEqual([InvoiceType.INVOICE, null, invoice.date]);
        expect(columns.find(c => c['name'] === 'type')?.['default']).toBeNull();
    });

    it('goes on with the counter of the recipient, without a jump', async () => {
        const number: string = await inTeam(async () => await inject(InvoiceNumberService).generateInvoiceNumber('siemens', siemens, undefined));
        const counters: NumberInvoices[] = await inTeam(async () => await inject(repositoryTokenFor(NumberInvoices)).findAll());

        expect(number).toBe(`${YEAR}-SIEMEN-0042`);
        expect(counters.map(c => [c.scope, c.number])).toEqual([[`${YEAR}-SIEMEN-{counter}`, 42]]);
    });

    // during a rolling deploy, and after going back, an instance of 3.2 draws by year and recipient alone
    it('keeps the key of 3.2 beside the one on the scope, and shares the counter with an instance of 3.2', async () => {
        const repository: Repository<NumberInvoices, OmitStrict<NumberInvoices, 'id' | 'tenantId'>> = inject(repositoryTokenFor(NumberInvoices));
        const uniques: Record<string, unknown>[] = await queryPostgres(
            inject(dataSourceClass),
            'SELECT indexdef AS "definition" FROM pg_indexes WHERE schemaname = current_schema() AND tablename = $1 AND indexdef LIKE \'CREATE UNIQUE%\'',
            [COUNTERS]
        );

        // what 3.2 runs for the next number of the recipient
        const ofThreeTwo: NumberInvoices = await inTeam(async () => await repository.upsert(
            { year: YEAR, recipientId: 'siemens' },
            { year: YEAR, recipientId: 'siemens', number: 1 },
            { number: { increment: 1 } }
        ));
        const next: string = await inTeam(async () => await inject(InvoiceNumberService).generateInvoiceNumber('siemens', siemens, undefined));

        // the columns of each, between the parentheses. Postgres quotes a column there only where its name needs it,
        // such as "recipientId", and leaves year and scope as they are
        expect(uniques.map(u => String(u['definition']))).toEqual(expect.arrayContaining([
            expect.stringMatching(/\((?=[^)]*\byear\b)(?=[^)]*"recipientId")[^)]*\)/),
            expect.stringMatching(/\([^)]*\bscope\b[^)]*\)/)
        ]));
        expect([ofThreeTwo.number, next]).toEqual([43, `${YEAR}-SIEMEN-0044`]);
    });

    it('cancels an invoice stored before', async () => {
        const invoices: Repository<Invoice> = inject(repositoryTokenFor(Invoice));
        const cancellations: InvoiceCancellationServiceInterface<Invoice> = inject<InvoiceCancellationServiceInterface<Invoice>>(
            ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CANCELLATION_SERVICE
        );

        const creditNote: Invoice = await inTeam(async () => await cancellations.cancelInvoice(INVOICE_ID));

        expect(creditNote.number).toBe(`${YEAR}-SIEMEN-0041-C1`);
        await expect(inTeam(async () => await invoices.deleteById(INVOICE_ID))).rejects.toThrow(
            `The invoice ${YEAR}-SIEMEN-0041 is referenced by the credit note ${creditNote.number}, and cannot be changed or deleted.`
        );
    });
});