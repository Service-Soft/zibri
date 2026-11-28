/* eslint-disable cspell/spellchecker */
import { createHash } from 'node:crypto';
import { buffer } from 'node:stream/consumers';

import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { testFileFolder, TestTimeouts } from '../../../__testing__/constants';
import { runApplicationClockAhead } from '../../../__testing__/run-application-clock-ahead.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { ArchiveRetentionError } from '../../../archive/archive-retention.error';
import { ChainGap } from '../../../data-source/chain/chain-gap.model';
import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { FileStore } from '../../../file/decorators/file-store.decorator';
import { FileRecord } from '../../../file/file-record.model';
import { FsFileStore } from '../../../file/stores/fs.file-store';
import { getZonedDate, ZonedDate } from '../../../localization/format-date.function';
import { FsPath, FsUtilities } from '../../../utilities/fs.utilities';
import { Ms } from '../../../utilities/ms';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { ZibriBankPlugin } from '../bank.plugin';
import { ZIBRI_BANK_PLUGIN_DI_TOKENS } from '../bank.tokens';
import { BankAccount, BankAccountCreateData } from '../models/bank-account.model';
import { BANK_STATEMENT_FILE_STORE_NAME } from '../models/bank-statement-file-store-name.model';
import { BankStatementImport } from '../models/bank-statement-import.model';
import { BankStatement } from '../models/bank-statement.model';
import { BankTransactionState } from '../models/bank-transaction-state.model';
import { BankTransaction } from '../models/bank-transaction.model';

const statementsFolder: FsPath = FsUtilities.getPath(testFileFolder, `bank-statements-${UUIDUtilities.generate()}`);

@FileStore()
class BankStatementFileStore extends FsFileStore {
    constructor() {
        super(BANK_STATEMENT_FILE_STORE_NAME, statementsFolder);
    }
}

/**
 * The account the samples are mostly of, and the second one the sample of version `.001.02` holds a statement of.
 */
const BUSINESS: BankAccountCreateData = { iban: 'DE89370400440532013000', name: 'Business account', currency: 'EUR' };
const SAVINGS: BankAccountCreateData = { iban: 'DE02120300000000202051', name: 'Savings', currency: 'EUR' };

/**
 * The samples: the 2nd of November of both accounts, the 3rd and the 4th of the business account, and one export of
 * the 2nd and the 3rd together.
 */
const SAMPLE_02: string = 'camt053-001-02.sample.xml';
const SAMPLE_08: string = 'camt053-001-08.sample.xml';
const SAMPLE_NEXT: string = 'camt053-001-02-next.sample.xml';
const SAMPLE_OVERLAPPING: string = 'camt053-001-08-overlapping.sample.xml';

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({
        fileStores: [BankStatementFileStore],
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, FileRecord, ChainGap, BankAccount, BankStatement, BankTransaction, BankTransactionState],
                repositories: defaultTestServerRepositories
            })
        ],
        plugins: [new ZibriBankPlugin()]
    });
}, TestTimeouts.inMemory.start);

afterEach(() => {
    jest.useRealTimers();
});

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(statementsFolder);
}, TestTimeouts.inMemory.shutdown);

/**
 * Reads a sample file.
 * @param name - The name of the sample.
 * @returns Its bytes.
 */
async function readSample(name: string): Promise<Buffer> {
    return Buffer.from(await FsUtilities.readFile(FsUtilities.getPath(__dirname, '..', '__testing__', name)));
}

async function inTenant<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
    return await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, work);
}

/**
 * Creates a tenant with bank accounts.
 * @param accounts - The accounts it has.
 * @returns The tenant.
 */
async function createTenant(...accounts: BankAccountCreateData[]): Promise<string> {
    const tenantId: string = UUIDUtilities.generate();
    const repository: Repository<BankAccount, BankAccountCreateData> = inject(repositoryTokenFor(BankAccount));
    await inTenant(tenantId, async () => await repository.createAll(accounts));
    return tenantId;
}

/**
 * Imports a file in a tenant, as the code of an application does.
 * @param tenantId - The tenant.
 * @param data - The file, or the name of a sample.
 * @returns What was stored.
 */
async function importFile(tenantId: string, data: string | Buffer): Promise<BankStatementImport> {
    const file: Buffer = typeof data === 'string' ? await readSample(data) : data;
    return await inTenant(tenantId, async () => await inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.BANK_STATEMENT_SERVICE)
        .importStatements({ name: typeof data === 'string' ? data : 'statement.xml', data: file }));
}

async function findStatements(tenantId: string): Promise<BankStatement[]> {
    return await inTenant(tenantId, async () => await inject<Repository<BankStatement>>(repositoryTokenFor(BankStatement))
        .findAll({ order: { chainSequence: 'ASC' } }));
}

/**
 * The transactions of a tenant, each as its amount, its counterparty and its text, ordered by them.
 * @param tenantId - The tenant.
 * @returns The transactions.
 */
async function findTransactions(tenantId: string): Promise<string[]> {
    const rows: BankTransaction[] = await inTenant(tenantId, async () => await inject<Repository<BankTransaction>>(repositoryTokenFor(BankTransaction))
        .findAll());
    return rows.map(t => `${t.amount.toFixed(2)} ${t.counterpartyName ?? '-'}: ${t.remittanceInformation ?? '-'}`).sort();
}

const TRANSACTIONS_02_BUSINESS: string[] = [
    '-100.00 Ada Lovelace: Expenses October',
    '-200.00 Grace Hopper: Expenses October',
    '-3.50 Corner Cafe: Coffee',
    '-3.50 Corner Cafe: Coffee',
    '-49.99 Hosting Inc: Server November',
    '1190.00 Great Company LLC: Invoice 2026-GREATC-0001'
];
const TRANSACTIONS_02_SAVINGS: string[] = ['100.00 Acme LLC: Transfer to savings'];
const TRANSACTIONS_08: string[] = ['250.00 Small Shop: Invoice 2026-SMALLS-0002', '49.99 Hosting Inc: Return of direct debit'];

describe('importing a statement of camt.053.001.02', () => {
    it('stores each statement of the file with its balances, and its booked transactions', async () => {
        const tenantId: string = await createTenant(BUSINESS, SAVINGS);

        const imported: BankStatementImport = await importFile(tenantId, SAMPLE_02);

        expect(imported).toMatchObject({ skippedStatementCount: 0, transactionCount: 7, skippedTransactionCount: 0 });
        const statements: BankStatement[] = await findStatements(tenantId);
        expect(statements.map(s => [s.bankStatementId, s.format, s.openingBalance.toFixed(2), s.closingBalance.toFixed(2)])).toEqual([
            ['B-2026-001', 'camt.053.001.02', '50.00', '150.00'],
            ['S-2026-001', 'camt.053.001.02', '1000.00', '1833.01']
        ]);
        const business: BankStatement | undefined = statements.find(s => s.bankStatementId === 'S-2026-001');
        expect(business).toMatchObject({
            electronicSequenceNumber: 1,
            currency: 'EUR',
            issuedAt: new Date('2026-11-02T21:00:00Z'),
            periodStart: new Date('2026-11-01T23:00:00Z'),
            periodEnd: new Date('2026-11-02T22:59:59Z'),
            openingBalanceDate: new Date('2026-11-01T00:00:00Z'),
            closingBalanceDate: new Date('2026-11-02T00:00:00Z')
        });
        expect(await findTransactions(tenantId)).toEqual([...TRANSACTIONS_02_BUSINESS, ...TRANSACTIONS_02_SAVINGS].sort());
    });

    it('reads the references, the counterparty and the creditor of a direct debit', async () => {
        const tenantId: string = await createTenant(BUSINESS, SAVINGS);
        await importFile(tenantId, SAMPLE_02);

        const rows: BankTransaction[] = await inTenant(tenantId, async () => await inject<Repository<BankTransaction>>(repositoryTokenFor(BankTransaction))
            .findAll({ where: { counterpartyName: { oneOf: ['Great Company LLC', 'Hosting Inc'] } } }));
        const invoice: BankTransaction | undefined = rows.find(t => t.counterpartyName === 'Great Company LLC');
        const debit: BankTransaction | undefined = rows.find(t => t.counterpartyName === 'Hosting Inc');
        expect(invoice).toMatchObject({
            bookingDate: new Date('2026-11-02T00:00:00Z'),
            valueDate: new Date('2026-11-02T00:00:00Z'),
            counterpartyIban: 'DE75512108001245126199',
            endToEndId: 'INV-2026-0001',
            bankReference: 'REF-0001',
            deduplicationKey: 'ref:REF-0001',
            mandateId: null,
            creditorId: null
        });
        expect(debit).toMatchObject({
            counterpartyIban: 'DE44500105175407324931',
            endToEndId: null,
            mandateId: 'MNDT-7',
            creditorId: 'DE98ZZZ09999999999',
            bankReference: null
        });
        expect(debit?.deduplicationKey).toMatch(/^hash:[\da-f]{64}$/);
    });
});

describe('importing a statement of camt.053.001.08', () => {
    it('stores the statement with its balances and its booked transactions, the parties of a reversal kept', async () => {
        const tenantId: string = await createTenant(BUSINESS);

        const imported: BankStatementImport = await importFile(tenantId, SAMPLE_08);

        expect(imported).toMatchObject({ skippedStatementCount: 0, transactionCount: 2, skippedTransactionCount: 0 });
        expect(imported.statements.map(s => [s.bankStatementId, s.format, s.openingBalance.toFixed(2), s.closingBalance.toFixed(2)]))
            .toEqual([['S-2026-002', 'camt.053.001.08', '1833.01', '2133.00']]);
        expect(await findTransactions(tenantId)).toEqual(TRANSACTIONS_08);
    });
});

describe('importing statements again', () => {
    it('stores each statement and transaction of a file imported twice once', async () => {
        const tenantId: string = await createTenant(BUSINESS, SAVINGS);
        await importFile(tenantId, SAMPLE_02);

        const again: BankStatementImport = await importFile(tenantId, SAMPLE_02);

        expect(again).toMatchObject({ statements: [], skippedStatementCount: 2, transactionCount: 0, skippedTransactionCount: 7 });
        expect(await findStatements(tenantId)).toHaveLength(2);
        expect(await findTransactions(tenantId)).toHaveLength(7);
    });

    it('stores the transactions of overlapping files once, whichever version holds them', async () => {
        const tenantId: string = await createTenant(BUSINESS, SAVINGS);
        await importFile(tenantId, SAMPLE_02);

        // the export of both days continues the 2nd by the bookings of that day it holds, and adds the 3rd
        const overlapping: BankStatementImport = await importFile(tenantId, SAMPLE_OVERLAPPING);
        // the statement of the 3rd holds nothing that is not stored by now
        const daily: BankStatementImport = await importFile(tenantId, SAMPLE_08);

        expect(overlapping).toMatchObject({ skippedStatementCount: 0, transactionCount: 2, skippedTransactionCount: 6 });
        expect(daily).toMatchObject({ statements: [], skippedStatementCount: 1, transactionCount: 0, skippedTransactionCount: 2 });
        expect(await findTransactions(tenantId)).toEqual([...TRANSACTIONS_02_BUSINESS, ...TRANSACTIONS_02_SAVINGS, ...TRANSACTIONS_08].sort());
        // and the statement after it continues the export
        expect(await importFile(tenantId, SAMPLE_NEXT)).toMatchObject({ transactionCount: 1 });
    });
});

describe('a gap between two statements', () => {
    it('refuses the statement after the gap, naming where the one before closed, until the missing one is imported', async () => {
        const tenantId: string = await createTenant(BUSINESS, SAVINGS);
        await importFile(tenantId, SAMPLE_02);

        await expect(importFile(tenantId, SAMPLE_NEXT)).rejects.toThrow(
            'The statement "S-2026-003" of DE89370400440532013000 opens with 2133, and needs to continue the statement "S-2026-001", '
            + 'which closed with 1833.01 on 2026-11-02.'
        );
        expect((await findStatements(tenantId)).map(s => s.bankStatementId)).toEqual(['B-2026-001', 'S-2026-001']);

        await importFile(tenantId, SAMPLE_08);
        expect(await importFile(tenantId, SAMPLE_NEXT)).toMatchObject({ transactionCount: 1 });
        expect((await findStatements(tenantId)).map(s => s.bankStatementId)).toEqual(['B-2026-001', 'S-2026-001', 'S-2026-002', 'S-2026-003']);
    });
});

describe('the accounts a file names', () => {
    it('refuses a file of an IBAN the tenant has no account of, naming it, and stores nothing of the file', async () => {
        const tenantId: string = await createTenant(BUSINESS);

        await expect(importFile(tenantId, SAMPLE_02)).rejects.toThrow(
            'The file holds a statement of the IBAN DE02120300000000202051, which needs to be added as a bank account before its statements are imported.'
        );
        expect(await findStatements(tenantId)).toEqual([]);
        expect(await findTransactions(tenantId)).toEqual([]);
    });

    it('imports into the account of the tenant importing, never into that of another tenant of the same IBAN', async () => {
        const acme: string = await createTenant(BUSINESS);
        const globex: string = await createTenant();

        await expect(importFile(globex, SAMPLE_08)).rejects.toThrow('The file holds a statement of the IBAN DE89370400440532013000');
        expect(await findStatements(acme)).toEqual([]);

        const both: string = await createTenant(BUSINESS);
        await importFile(both, SAMPLE_08);
        expect(await findTransactions(both)).toEqual(TRANSACTIONS_08);
        expect(await findTransactions(acme)).toEqual([]);
    });

    it('refuses a statement in another currency than its account', async () => {
        const tenantId: string = await createTenant({ ...BUSINESS, currency: 'USD' });

        await expect(importFile(tenantId, SAMPLE_08)).rejects.toThrow(
            'The statement "S-2026-002" needs to be in USD, the currency of the account DE89370400440532013000.'
        );
    });
});

describe('an invalid file', () => {
    it('is refused without storing anything, when a statement of it does not add up', async () => {
        const tenantId: string = await createTenant(BUSINESS, SAVINGS);
        // the statement of the savings account closes a cent above what its entries make of its opening balance
        const broken: Buffer = Buffer.from((await readSample(SAMPLE_02)).toString('utf8').replace('150.00', '150.01'));

        await expect(importFile(tenantId, broken)).rejects.toThrow(
            'The booked entries of the statement "B-2026-001" need to add up from its opening balance 50 to its closing balance 150.01.'
        );
        expect(await findStatements(tenantId)).toEqual([]);
        expect(await findTransactions(tenantId)).toEqual([]);
        const files: FileRecord[] = await inTenant(tenantId, async () => await inject<Repository<FileRecord>>(repositoryTokenFor(FileRecord)).findAll());
        expect(files).toEqual([]);
    });

    it('is refused when it is not xml, of another version, or not a statement', async () => {
        const tenantId: string = await createTenant(BUSINESS);
        const sample: string = (await readSample(SAMPLE_08)).toString('utf8');

        await expect(importFile(tenantId, Buffer.from('Date;Amount\n2026-11-02;12.00'))).rejects.toThrow('The file needs to be a well formed xml document.');
        await expect(importFile(tenantId, Buffer.from(sample.replace('camt.053.001.08', 'camt.052.001.08')))).rejects.toThrow(
            'The file needs to be a CAMT.053 statement of the version camt.053.001.02 or camt.053.001.08.'
        );
        await expect(importFile(tenantId, Buffer.from(sample.replace('<CdtDbtInd>CRDT</CdtDbtInd>', '<CdtDbtInd>PLUS</CdtDbtInd>'))))
            .rejects.toThrow('The file needs to be a CAMT.053 statement, and could not be read as one.');
        expect(await findStatements(tenantId)).toEqual([]);
    });
});

describe('a pending entry', () => {
    it('is left out of the import, and of the balance of its statement', async () => {
        const tenantId: string = await createTenant(BUSINESS, SAVINGS);

        await importFile(tenantId, SAMPLE_02);

        expect(await findTransactions(tenantId)).not.toContainEqual(expect.stringContaining('Late Payer'));
    });
});

describe('the original file of a statement', () => {
    it('is archived with it in the store bank-statements for 8 years from the end of the year, and refused deletion before', async () => {
        const tenantId: string = await createTenant(BUSINESS);
        const sample: Buffer = await readSample(SAMPLE_08);
        const [statement] = (await importFile(tenantId, sample)).statements;
        if (statement == undefined) {
            throw new Error('The sample holds a statement.');
        }

        const read: Buffer = await inTenant(tenantId, async () => await buffer(await inject(ZIBRI_DI_TOKENS.ARCHIVE_SERVICE).readFile(statement, statement.file)));
        expect(read).toEqual(sample);
        const sha256: string = createHash('sha256')
            .update(sample)
            .digest('hex');
        expect(statement.archivedFiles).toEqual([{ id: statement.file, sha256, copies: [] }]);
        const record: FileRecord | undefined = await inTenant(tenantId, async () => await inject(ZIBRI_DI_TOKENS.FILE_SERVICE).findFile(statement.file));
        expect(record?.storeName).toBe(BANK_STATEMENT_FILE_STORE_NAME);
        const end: ZonedDate = getZonedDate(statement.retainUntil, inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS).defaultTimezone);
        expect([end.year, end.month, end.day, end.hours, end.minutes]).toEqual([2035, 0, 1, 0, 0]);

        const statements: Repository<BankStatement> = inject(repositoryTokenFor(BankStatement));
        await expect(inTenant(tenantId, async () => await statements.deleteById(statement.id))).rejects.toThrow(ArchiveRetentionError);

        runApplicationClockAhead(9 * 366 * Ms.DAY);
        await inTenant(tenantId, async () => await statements.deleteById(statement.id));
        expect(await findStatements(tenantId)).toEqual([]);
    });
});