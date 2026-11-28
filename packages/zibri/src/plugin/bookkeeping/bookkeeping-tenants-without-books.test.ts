/* eslint-disable cspell/spellchecker */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { companyInfoProvider } from '../../__testing__/mocks/company-info-provider.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { ConflictError } from '../../error-handling/errors/conflict.error';
import { OmitStrict } from '../../types/omit-strict.type';
import { FsUtilities } from '../../utilities/fs.utilities';
import { BigNumber } from '../../utilities/number.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { ZibriInvoicingPlugin } from '../invoicing/invoicing.plugin';
import { InvoiceRecipientAbbreviation } from '../invoicing/models/invoice-recipient-abbreviation.model';
import { Invoice } from '../invoicing/models/invoice.model';
import { NumberInvoices } from '../invoicing/models/number-invoices.model';
import { bookkeepingTestEntities, day, inTenant, ReceiptsFileStore, receiptsFolder } from './bookkeeping.cases';
import { ZibriBookkeepingPlugin } from './bookkeeping.plugin';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from './bookkeeping.tokens';
import { BookkeepingAccountType } from './models/bookkeeping-account-type.enum';
import { BookkeepingAccount, BookkeepingAccountCreateData } from './models/bookkeeping-account.model';
import { Expense } from './models/expense.model';

// an application refusing what a tenant without books would post: the one answer of `tenantsWithoutBooks` that the
// cases of the postings, which post nothing there, leave out. In memory, as nothing here depends on where the rows are
// stored

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({
        fileStores: [ReceiptsFileStore],
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, ...bookkeepingTestEntities, Invoice, NumberInvoices, InvoiceRecipientAbbreviation],
                repositories: defaultTestServerRepositories
            })
        ],
        plugins: [new ZibriBookkeepingPlugin(), new ZibriInvoicingPlugin()],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({ token: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: { tenantsWithoutBooks: 'refuse' } }),
            companyInfoProvider(() => ({
                name: 'Example Company',
                fullName: 'Example Company LLC',
                email: 'info@example-company.com',
                phone: '12345 67890123',
                timezone: 'Europe/Berlin',
                address: { street: 'Example street', number: '1b', postcode: '12345', city: 'Example city', countryId: 'DE' },
                taxNumber: '123/456/78910',
                vatNumber: 'DE123456789',
                ceo: 'James Smith',
                iban: 'DE75512108001245126199',
                bic: 'ABCDDEFFXXX'
            }))
        ]
    });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(receiptsFolder);
}, TestTimeouts.inMemory.shutdown);

describe('a tenant without bookkeeping settings, with tenantsWithoutBooks set to refuse', () => {
    it('cannot issue an invoice, which is not stored', async () => {
        const tenantId: string = UUIDUtilities.generate();
        const invoices: Repository<Invoice, OmitStrict<Invoice, 'id' | 'tenantId'>> = inject(repositoryTokenFor(Invoice));

        const issuing: Promise<Invoice> = inTenant(tenantId, async () => await invoices.create({
            number: '2026-SIEMEN-0001',
            currency: 'EUR',
            items: [{ name: 'Consulting', amount: 1, amountUnit: { code: 'HUR', displayName: 'Hours' }, vat: { categoryCode: 'S', rate: 19 }, price: 100 }],
            date: new Date('2026-03-01T12:00:00.000Z'),
            performanceDate: new Date('2026-03-01T12:00:00.000Z'),
            dueDate: new Date('2026-03-15T12:00:00.000Z'),
            customerAddressData: {
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
            },
            textBeforeItems: [],
            textAfterItems: [],
            issuedAt: new Date()
        }));

        await expect(issuing).rejects.toThrow(ConflictError);
        await expect(issuing).rejects.toThrow('The bookkeeping settings of the tenant need to be created before anything of it is posted.');
        expect(await inTenant(tenantId, async () => await invoices.count())).toBe(0);
    });

    it('cannot record an expense, which stays a draft', async () => {
        const tenantId: string = UUIDUtilities.generate();
        const draft: Expense = await inTenant(tenantId, async () => {
            const rent: BookkeepingAccount = await inject<Repository<BookkeepingAccount, BookkeepingAccountCreateData>>(repositoryTokenFor(BookkeepingAccount))
                .create({ number: '4210', name: 'Rent', type: BookkeepingAccountType.EXPENSE, statementPosition: null });
            return await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.EXPENSE_SERVICE).createExpense({
                supplier: { name: 'Landlord GmbH' },
                documentNumber: 'R-1',
                documentDate: day('2026-03-01'),
                totals: [{ rate: 0, net: new BigNumber(500), tax: new BigNumber(0) }],
                currency: 'EUR',
                accountId: rent.id
            });
        });

        await expect(inTenant(tenantId, async () => await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.EXPENSE_SERVICE).recordExpense(draft.id)))
            .rejects.toThrow('The bookkeeping settings of the tenant need to be created before anything of it is posted.');
        expect((await inTenant(tenantId, async () => await inject<Repository<Expense>>(repositoryTokenFor(Expense)).findById(draft.id))).recordedAt).toBeNull();
    });
});