/* eslint-disable cspell/spellchecker */
import { Readable } from 'node:stream';

import { describe, expect, it } from '@jest/globals';

import { ZipTestEntry, ZipTestUtilities } from '../../__testing__/zip-test.utilities';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { type XmlElementNode } from '../../document/xml-element-node.model';
import { XmlReaderUtilities } from '../../document/xml-reader.utilities';
import { XmlUtilities } from '../../document/xml.utilities';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { type FileRecord } from '../../file/file-record.model';
import { FsUtilities } from '../../utilities/fs.utilities';
import { BigNumber, NumberUtilities } from '../../utilities/number.utilities';
import { DiProvider, defineProvider } from '../../di/models/di-provider.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { ZIBRI_BANK_PLUGIN_DI_TOKENS } from '../bank/bank.tokens';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../invoicing/invoicing.tokens';
import { InvoiceDocument } from '../invoicing/models/invoice-document.model';
import { Invoice } from '../invoicing/models/invoice.model';
import { type InvoicingOptionsInput } from '../invoicing/models/invoicing-options-input.model';
import { createPostingBooks, itemOf, type PostingBooks, postingTestEntities, rentOf } from './bookkeeping-postings.cases';
import { createSeededBooks, reportTestProviders } from './bookkeeping-reports.cases';
import { day, inTenant, journal, ReceiptsFileStore, storeOf } from './bookkeeping.cases';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from './bookkeeping.tokens';
import { type BookkeepingExportArchive } from './models/bookkeeping-export-archive.model';
import { type BookkeepingExportOptions } from './models/bookkeeping-export-options.model';
import { type BookkeepingTrialBalance } from './models/bookkeeping-trial-balance.model';
import { EXPENSE_RECEIPT_FILE_STORE_NAME } from './models/expense-receipt-file-store-name.model';
import { type ExpenseReceipt } from './models/expense-receipt.model';
import { type Expense } from './models/expense.model';
import { JournalEntry } from './models/journal-entry.model';
import { type ExpenseServiceInterface } from './services/expense-service.interface';

/**
 * The cases every data source answers the same way about the export of a fiscal year for a tax audit. A file per data
 * source runs them, with {@link exportTestEntities}, {@link exportTestProviders}, and the file stores and plugins of the
 * cases of the reports.
 */

/**
 * The entities of the cases: those of the postings, and the documents the invoicing plugin archives.
 */
export const exportTestEntities: Newable<BaseEntity>[] = [...postingTestEntities, InvoiceDocument];

/**
 * The providers of the cases: those of the reports, and the invoicing plugin archiving the documents of issued
 * invoices in the store of the receipts, as an XRechnung where the customer has an email.
 */
export const exportTestProviders: DiProvider<unknown>[] = [
    ...reportTestProviders,
    defineProvider<InvoicingOptionsInput>({
        token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
        useValue: {
            archive: {
                store: EXPENSE_RECEIPT_FILE_STORE_NAME,
                locale: 'en-US',
                resolveConformance: invoice => invoice.customerAddressData.email == undefined ? undefined : 'x-rechnung'
            }
        }
    })
];

/**
 * The tables every export holds, with the plugins of the cases registered, in the order they are written.
 */
const TABLES: string[] = [
    'fiscal-years',
    'accounts',
    'journal-entries',
    'journal-entry-lines',
    'invoices',
    'expenses',
    'bank-matches',
    'bank-statements',
    'fiscal-year-statements',
    'verification',
    'verification-problems'
];

/**
 * The elements of a `Table` in the order `gdpdu-01-09-2004.dtd` declares them, as far as the export writes them.
 */
const TABLE_ELEMENTS: string[] = ['URL', 'Name', 'Description', 'Validity', 'UTF8', 'DecimalSymbol', 'DigitGroupingSymbol', 'Range', 'VariableLength'];

/**
 * An archive of an export, read back.
 */
export type ReadExport = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    fileName: string,
    // eslint-disable-next-line jsdoc/require-jsdoc
    mimeType: string,
    /**
     * Every file, by its path.
     */
    files: Map<string, Buffer>,
    /**
     * Each table, by its name, as its records: the header first.
     */
    tables: Map<string, string[][]>,
    /**
     * The text of `index.xml`.
     */
    index: string
};

/**
 * Exports a fiscal year of a tenant and reads the archive back.
 * @param tenantId - The tenant.
 * @param fiscalYearId - The fiscal year.
 * @param options - The options of the export.
 * @returns The archive, read.
 */
async function exportYear(tenantId: string, fiscalYearId: string, options?: BookkeepingExportOptions): Promise<ReadExport> {
    const archive: BookkeepingExportArchive = await inTenant(
        tenantId,
        async () => await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.EXPORT_SERVICE).exportFiscalYear(fiscalYearId, options)
    );
    // read outside the tenant, as a response is sent
    const pieces: Buffer[] = [];
    for await (const piece of archive.content) {
        pieces.push(piece);
    }
    return readExport(archive.fileName, archive.mimeType, Buffer.concat(pieces));
}

/**
 * Reads an archive of an export.
 * @param fileName - Its name.
 * @param mimeType - Its mime type.
 * @param archive - Its bytes.
 * @returns The archive, read.
 */
export function readExport(fileName: string, mimeType: string, archive: Buffer): ReadExport {
    const entries: ZipTestEntry[] = ZipTestUtilities.unpack(archive);
    const files: Map<string, Buffer> = new Map(entries.map(e => [e.name, e.content]));
    const tables: Map<string, string[][]> = new Map(entries
        .filter(e => e.name.endsWith('.csv'))
        .map(e => [e.name.slice(0, -'.csv'.length), parseCsv(e.content.toString('utf8'))]));
    return { fileName, mimeType, files, tables, index: files.get('index.xml')?.toString('utf8') ?? '' };
}

/**
 * Reads CSV as the description standard of the export describes it: `;` between values, text in `"` with a `"` in it
 * doubled, each record ended by CRLF.
 * @param csv - The text.
 * @returns The records, each as its values, without the quotes.
 */
function parseCsv(csv: string): string[][] {
    expect(csv.endsWith('\r\n')).toBe(true);
    const records: string[][] = [];
    let record: string[] = [];
    let value: string = '';
    let quoted: boolean = false;
    for (let index: number = 0; index < csv.length; index++) {
        const character: string = csv[index] ?? '';
        if (quoted) {
            if (character === '"' && csv[index + 1] === '"') {
                value += '"';
                index++;
            }
            else if (character === '"') {
                quoted = false;
            }
            else {
                value += character;
            }
        }
        else if (character === '"') {
            quoted = true;
        }
        else if (character === ';') {
            record.push(value);
            value = '';
        }
        else if (character === '\r' && csv[index + 1] === '\n') {
            record.push(value);
            records.push(record);
            record = [];
            value = '';
            index++;
        }
        else {
            // a line break inside a record, which the export never writes
            expect(character).not.toBe('\n');
            value += character;
        }
    }
    return records;
}

/**
 * The rows of a table of an export, each as its values by the names of the header.
 * @param read - The export.
 * @param table - The name of the table.
 * @returns The rows.
 */
function rowsOf(read: ReadExport, table: string): Record<string, string>[] {
    const [header, ...records] = read.tables.get(table) ?? [];
    if (header == undefined) {
        throw new Error(`The export has no table ${table}.`);
    }
    return records.map(record => Object.fromEntries(header.map((name, index) => [name, record[index] ?? ''])));
}

/**
 * Reads an amount as the export writes it, with a decimal comma.
 * @param value - The value, empty for none.
 * @returns The amount, 0 for none.
 */
function amountOf(value: string): BigNumber {
    return value === '' ? new BigNumber(0) : new BigNumber(value.replace(',', '.'));
}

/**
 * The child elements of an element of `index.xml`.
 * @param element - The element.
 * @param name - The name of the children, every child by default.
 * @returns The children.
 */
function childrenOf(element: XmlElementNode | undefined, name?: string): XmlElementNode[] {
    return (element?.content ?? []).filter((c): c is XmlElementNode => typeof c !== 'string' && (name == undefined || c.name === name));
}

/**
 * The text of the child of an element of `index.xml`.
 * @param element - The element.
 * @param name - The name of the child.
 * @returns Its text, empty for none.
 */
function textOf(element: XmlElementNode | undefined, name: string): string {
    return childrenOf(element, name)[0]?.content.filter(c => typeof c === 'string').join('') ?? '';
}

/**
 * Validates `index.xml` of an export against the description standard, as far as the export writes it, and against
 * the files of the archive: well formed and naming its definition, a description of each CSV file in the order of its
 * columns, each column of exactly one kind, and its numbers and days written the way it describes.
 * @param read - The export.
 * @returns The root element.
 */
function validateIndex(read: ReadExport): XmlElementNode {
    expect(XmlUtilities.resolveXmlString(read.index)).toBe(read.index);
    expect(read.index.split('\n').slice(0, 2)).toEqual(['<?xml version="1.0" encoding="UTF-8"?>', '<!DOCTYPE DataSet SYSTEM "gdpdu-01-09-2004.dtd">']);
    const root: XmlElementNode = XmlReaderUtilities.resolveRootElement(read.index);
    expect(root.name).toBe('DataSet');
    expect(childrenOf(root).map(c => c.name)).toEqual(['Version', 'DataSupplier', 'Media']);
    expect(childrenOf(childrenOf(root, 'DataSupplier')[0]).map(c => c.name)).toEqual(['Name', 'Location', 'Comment']);
    const media: XmlElementNode | undefined = childrenOf(root, 'Media')[0];
    expect(childrenOf(media).map(c => c.name)).toEqual(['Name', ...[...read.tables.keys()].map(() => 'Table')]);
    const tables: XmlElementNode[] = childrenOf(media, 'Table');
    // every CSV file of the archive described, and nothing else
    expect(tables.map(t => textOf(t, 'URL')).sort()).toEqual([...read.tables.keys()].map(name => `${name}.csv`).sort());
    for (const table of tables) {
        const name: string = textOf(table, 'Name');
        expect([name, childrenOf(table).map(c => c.name)]).toEqual([name, TABLE_ELEMENTS]);
        expect([name, textOf(table, 'Description')]).toEqual([name, expect.stringMatching(/\S/)]);
        expect([textOf(table, 'DecimalSymbol'), textOf(table, 'DigitGroupingSymbol')]).toEqual([',', '.']);
        expect(textOf(childrenOf(table, 'Range')[0], 'From')).toBe('2');
        const validity: XmlElementNode | undefined = childrenOf(table, 'Validity')[0];
        expect(childrenOf(validity).map(c => c.name)).toEqual(['Range', 'Format']);
        expect(textOf(validity, 'Format')).toBe('DD.MM.YYYY');
        const layout: XmlElementNode | undefined = childrenOf(table, 'VariableLength')[0];
        expect([textOf(layout, 'ColumnDelimiter'), textOf(layout, 'TextEncapsulator')]).toEqual([';', '"']);
        const layoutNames: string[] = childrenOf(layout).map(c => c.name);
        // the primary key, then the columns, then the foreign keys, as the definition orders them
        expect(layoutNames.join(' ')).toMatch(/^ColumnDelimiter TextEncapsulator (VariablePrimaryKey )?(VariableColumn ?)+( ForeignKey)*$/);
        const columns: XmlElementNode[] = childrenOf(layout).filter(c => c.name === 'VariablePrimaryKey' || c.name === 'VariableColumn');
        const [header, ...records] = read.tables.get(name) ?? [];
        expect([name, columns.map(c => textOf(c, 'Name'))]).toEqual([name, header]);
        columns.forEach((column, index) => {
            const kinds: string[] = childrenOf(column).map(c => c.name).filter(n => n !== 'Name' && n !== 'Description');
            expect([name, textOf(column, 'Name'), kinds.length, textOf(column, 'Description')])
                .toEqual([name, textOf(column, 'Name'), 1, expect.stringMatching(/\S/)]);
            const pattern: RegExp | undefined = kinds[0] === 'Numeric'
                ? new RegExp(`^-?\\d+${Number(textOf(childrenOf(column, 'Numeric')[0], 'Accuracy')) > 0 ? `,\\d{${textOf(childrenOf(column, 'Numeric')[0], 'Accuracy')}}` : ''}$`)
                : kinds[0] === 'Date' ? /^\d{2}\.\d{2}\.\d{4}$/ : undefined;
            for (const record of records) {
                const value: string = record[index] ?? '';
                if (pattern != undefined && value !== '') {
                    expect([name, textOf(column, 'Name'), value]).toEqual([name, textOf(column, 'Name'), expect.stringMatching(pattern)]);
                }
            }
        });
        for (const key of childrenOf(layout, 'ForeignKey')) {
            expect(tables.map(t => textOf(t, 'Name'))).toContain(textOf(key, 'References'));
        }
    }
    return root;
}

/**
 * Keeps the receipt of a new expense of the books, and records it.
 * @param books - The books.
 * @param content - The bytes of the receipt.
 * @returns The receipt and the expense.
 */
async function recordExpenseWithReceipt(books: PostingBooks, content: Buffer): Promise<[ExpenseReceipt, Expense]> {
    return await inTenant(books.tenantId, async () => {
        const expenses: ExpenseServiceInterface = inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.EXPENSE_SERVICE);
        const receipt: ExpenseReceipt = await expenses.createReceipt({ name: 'Büro Miete März.pdf', mimeType: 'application/pdf', data: content });
        const draft: Expense = await expenses.createExpense(rentOf(books, { documentNumber: 'R-78', documentDate: day('2026-03-10'), receiptId: receipt.id }));
        return [receipt, await expenses.recordExpense(draft.id)];
    });
}

/**
 * Runs every case against one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 */
export function describeBookkeepingExport(dataSourceName: string): void {
    describe(`the export of a fiscal year on ${dataSourceName}`, () => {
        it('holds every entry once, and its CSV files read back reproduce the trial balance of the year', async () => {
            const books: PostingBooks = await createSeededBooks();

            const read: ReadExport = await exportYear(books.tenantId, books.fiscalYear.id);

            expect([read.fileName, read.mimeType]).toEqual(['gobd-export-2026.zip', 'application/zip']);
            expect([...read.tables.keys()]).toEqual(TABLES);
            const entries: JournalEntry[] = await inTenant(books.tenantId, async () => await inject<Repository<JournalEntry>>(repositoryTokenFor(JournalEntry))
                .findAll({ where: { fiscalYearId: books.fiscalYear.id }, limit: 'all' }));
            const exportedEntries: Record<string, string>[] = rowsOf(read, 'journal-entries');
            expect(exportedEntries.map(e => e['id']).sort()).toEqual(entries.map(e => e.id).sort());
            expect(new Set(exportedEntries.map(e => e['id'])).size).toBe(exportedEntries.length);
            expect(exportedEntries.map(e => e['sequence'])).toEqual(entries.map((_, index) => String(index + 1)));
            expect(exportedEntries[0]).toMatchObject({ postingDate: '02.01.2026', documentReference: 'Notary 2026-1', text: 'Share capital' });

            // the trial balance, added up from the lines and the accounts alone
            const numbers: Map<string, string> = new Map(rowsOf(read, 'accounts').map(a => [a['id'] ?? '', a['number'] ?? '']));
            const totals: Map<string, [BigNumber, BigNumber]> = new Map();
            for (const line of rowsOf(read, 'journal-entry-lines')) {
                const number: string = numbers.get(line['accountId'] ?? '') ?? '';
                expect(line['accountNumber']).toBe(number);
                const [debit, credit] = totals.get(number) ?? [new BigNumber(0), new BigNumber(0)];
                totals.set(number, [NumberUtilities.add(debit, amountOf(line['debit'] ?? '')), NumberUtilities.add(credit, amountOf(line['credit'] ?? ''))]);
            }
            const trialBalance: BookkeepingTrialBalance = await inTenant(
                books.tenantId,
                async () => await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.REPORT_SERVICE).resolveTrialBalance(books.fiscalYear.id, undefined)
            );
            expect([...totals.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([number, [debit, credit]]) => [number, debit.toFixed(2), credit.toFixed(2)]))
                .toEqual(trialBalance.rows.map(r => [r.account.number, r.debit.toFixed(2), r.credit.toFixed(2)]));
            expect(trialBalance.debit.toFixed(2)).toBe('29301.00');

            // what posted the entries
            expect(rowsOf(read, 'invoices').map(i => [i['number'], i['type'], i['date'], i['net'], i['tax'], i['gross']]).sort()).toEqual([
                ['2026-SIEMEN-0001', 'INVOICE', '01.03.2026', '1000,00', '190,00', '1190,00'],
                ['2026-SIEMEN-0002', 'INVOICE', '01.03.2026', '500,00', '95,00', '595,00'],
                [expect.any(String), 'CREDIT_NOTE', '01.04.2026', '200,00', '38,00', '238,00']
            ]);
            expect(rowsOf(read, 'expenses').map(e => [e['documentNumber'], e['documentDate'], e['supplier'], e['net'], e['tax'], e['receipt']]))
                .toEqual([['R-77', '05.03.2026', 'Office Supplies GmbH', '100,00', '19,00', '']]);
            expect(rowsOf(read, 'bank-matches').map(m => [m['bookingDate'], m['transactionAmount'], m['amount']]).sort()).toEqual([
                ['20.03.2026', '-119,00', '119,00'],
                ['20.03.2026', '1190,00', '1190,00']
            ]);
            expect(rowsOf(read, 'fiscal-years')).toEqual([{ id: books.fiscalYear.id, start: '01.01.2026', end: '31.12.2026', closedAt: '', reopenings: '0', currency: 'EUR' }]);
            expect(rowsOf(read, 'verification')).toEqual([expect.objectContaining({ intact: 'true', problems: '0', unreadableDocuments: '0' })]);
            expect(rowsOf(read, 'verification-problems')).toEqual([]);

            const root: XmlElementNode = validateIndex(read);
            expect(textOf(childrenOf(root, 'DataSupplier')[0], 'Name')).toBe('Example GmbH');
            expect(textOf(childrenOf(root, 'DataSupplier')[0], 'Comment')).toContain('intact');
        });

        it('holds the receipts, the bank statements and the archived statements, unless it is asked not to', async () => {
            const books: PostingBooks = await createSeededBooks();
            const receiptContent: Buffer = Buffer.from('%PDF-1.4 rent of March');
            const [receipt, expense] = await recordExpenseWithReceipt(books, receiptContent);
            // archived with its XRechnung, as its customer has an email
            const electronic: Invoice = await inTenant(books.tenantId, async () => await inject<Repository<Invoice, OmitStrict<Invoice, 'id' | 'tenantId'>>>(
                repositoryTokenFor(Invoice)
            ).create({
                number: '2026-GREATC-0001',
                currency: 'EUR',
                items: [itemOf(100)],
                date: new Date('2026-06-01T12:00:00.000Z'),
                performanceDate: new Date('2026-06-01T12:00:00.000Z'),
                dueDate: new Date('2026-06-15T12:00:00.000Z'),
                customerAddressData: {
                    formOfAddress: '',
                    firstName: '',
                    lastName: '',
                    street: 'Great Street',
                    number: '42',
                    postcode: '12345',
                    city: 'Great City',
                    company: true,
                    companyName: 'Great Company',
                    countryId: 'DE',
                    email: 'info@great-company.com'
                },
                textBeforeItems: [],
                textAfterItems: [],
                issuedAt: new Date()
            }));
            const statementContent: Buffer = Buffer.from(await FsUtilities.readFile(FsUtilities.getPath(__dirname, '..', 'bank', '__testing__', 'camt053-001-08.sample.xml')));
            await inTenant(books.tenantId, async () => await inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.BANK_STATEMENT_SERVICE)
                .importStatements({ name: 'statement-2026-11-03.xml', data: statementContent }));
            await inTenant(books.tenantId, async () => {
                await journal().updateFiscalYear(books.fiscalYear.id, { averageEmployees: 2 });
                await journal().closeFiscalYear(books.fiscalYear.id, { resultAccountId: books.accounts.result.id });
            });

            const read: ReadExport = await exportYear(books.tenantId, books.fiscalYear.id);

            // the line of the closing carrying the result into equity, and no other, says so
            expect(rowsOf(read, 'journal-entry-lines').filter(l => l['role'] !== '').map(l => [l['accountId'], l['role']]))
                .toEqual([[books.accounts.result.id, 'result']]);
            const receiptPath: string = `documents/expense-receipts/${receipt.id}-B_ro_Miete_M_rz.pdf`;
            expect(rowsOf(read, 'expenses').find(e => e['id'] === expense.id)?.['receipt']).toBe(receiptPath);
            expect(read.files.get(receiptPath)?.equals(receiptContent)).toBe(true);
            const [statement] = rowsOf(read, 'bank-statements');
            // from midnight in Berlin, the day before in UTC, the defaultTimezone of the cases
            expect(statement).toMatchObject({ periodStart: '02.11.2026', periodEnd: '03.11.2026', file: expect.stringMatching(/^documents\/bank-statements\/.+-statement-2026-11-03\.xml$/) });
            expect(read.files.get(statement?.['file'] ?? '')?.equals(statementContent)).toBe(true);
            const archived: Record<string, string>[] = rowsOf(read, 'fiscal-year-statements');
            expect(archived).toHaveLength(4);
            for (const row of archived) {
                expect(read.files.get(row['file'] ?? '')?.subarray(0, 5).toString()).toBe('%PDF-');
            }
            expect(rowsOf(read, 'fiscal-years')[0]?.['closedAt']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
            // the pdf archived at the issue of each invoice and credit note, and the xml of the one that has one
            const invoiceRows: Record<string, string>[] = rowsOf(read, 'invoices');
            expect(invoiceRows).toHaveLength(4);
            const archivedInvoices: InvoiceDocument[] = await inTenant(books.tenantId, async () => await inject<Repository<InvoiceDocument>>(
                repositoryTokenFor(InvoiceDocument)
            ).findAll({ limit: 'all' }));
            for (const row of invoiceRows) {
                const document: InvoiceDocument | undefined = archivedInvoices.find(d => d.invoiceId === row['id']);
                const stored: Buffer = await inTenant(books.tenantId, async () => await inject(ZIBRI_DI_TOKENS.FILE_SERVICE).read(document?.pdf ?? ''));
                expect(row['pdf']).toMatch(/^documents\/invoices\/.+\.pdf$/);
                expect(read.files.get(row['pdf'] ?? '')?.equals(stored)).toBe(true);
                expect([row['number'], row['electronicInvoice'] !== '']).toEqual([row['number'], row['id'] === electronic.id]);
            }
            const xmlPath: string = invoiceRows.find(r => r['id'] === electronic.id)?.['electronicInvoice'] ?? '';
            expect(read.files.get(xmlPath)?.toString()).toContain('<rsm:CrossIndustryInvoice');
            expect([...read.files.keys()].filter(name => name.startsWith('documents/'))).toHaveLength(11);
            validateIndex(read);

            const withoutDocuments: ReadExport = await exportYear(books.tenantId, books.fiscalYear.id, { documents: false });

            expect([...withoutDocuments.files.keys()].filter(name => name.startsWith('documents/'))).toEqual([]);
            expect([...withoutDocuments.tables.keys()]).toEqual(TABLES);
            expect(rowsOf(withoutDocuments, 'expenses').find(e => e['id'] === expense.id)).toMatchObject({ receiptId: receipt.id, receipt: '' });
            expect(rowsOf(withoutDocuments, 'bank-statements').map(s => s['file'])).toEqual(['']);
            expect(rowsOf(withoutDocuments, 'fiscal-year-statements').map(s => s['file'])).toEqual(['', '', '', '']);
            expect(rowsOf(withoutDocuments, 'invoices').map(i => [i['pdf'], i['electronicInvoice']])).toEqual([['', ''], ['', ''], ['', ''], ['', '']]);
            validateIndex(withoutDocuments);
        });

        it('exports the books of a broken chain as they are, and says so', async () => {
            const books: PostingBooks = await createSeededBooks();
            const entries: Repository<JournalEntry> = inject(repositoryTokenFor(JournalEntry));
            const changed: JournalEntry | undefined = (await inTenant(books.tenantId, async () => await entries.findAll({
                where: { fiscalYearId: books.fiscalYear.id },
                order: { sequence: 'ASC' },
                limit: 'all'
            })))[2];
            await storeOf(entries).updateAll({ where: { id: changed?.id }, data: { text: 'Rewritten' } });

            const read: ReadExport = await exportYear(books.tenantId, books.fiscalYear.id);

            expect(rowsOf(read, 'journal-entries').find(e => e['id'] === changed?.id)?.['text']).toBe('Rewritten');
            expect(rowsOf(read, 'verification')).toEqual([expect.objectContaining({ intact: 'false', newestEntrySequence: '', newestEntryHash: '', problems: '1' })]);
            expect(rowsOf(read, 'verification-problems')).toEqual([
                { entryId: changed?.id, lineId: '', document: '', reason: 'The row is not as it was written.' }
            ]);
            const root: XmlElementNode = validateIndex(read);
            expect(textOf(childrenOf(root, 'DataSupplier')[0], 'Comment')).toMatch(/^Checking the books found that the chains .* do not hold/);
            const verification: XmlElementNode | undefined = childrenOf(childrenOf(root, 'Media')[0], 'Table').find(t => textOf(t, 'Name') === 'verification');
            expect(textOf(verification, 'Description')).toContain('do not hold');
        });

        it('states a document that cannot be read unchanged, and exports the rest', async () => {
            const books: PostingBooks = await createPostingBooks();
            const [receipt] = await recordExpenseWithReceipt(books, Buffer.from('%PDF-1.4 a receipt'));
            // the bytes of the file changed in its store, past the archive
            const record: FileRecord | undefined = await inTenant(books.tenantId, async () => await inject(ZIBRI_DI_TOKENS.FILE_SERVICE).findFile(receipt.file));
            await new ReceiptsFileStore().put(record?.key ?? '', Readable.from([Buffer.from('%PDF-1.4 another receipt')]));

            const read: ReadExport = await exportYear(books.tenantId, books.fiscalYear.id);

            const path: string = rowsOf(read, 'expenses')[0]?.['receipt'] ?? '';
            expect(path).toContain(receipt.id);
            expect(read.files.has(path)).toBe(false);
            expect(rowsOf(read, 'verification')).toEqual([expect.objectContaining({ intact: 'true', unreadableDocuments: '1' })]);
            expect(rowsOf(read, 'verification-problems')).toEqual([
                { entryId: '', lineId: '', document: path, reason: expect.stringContaining('The document could not be read unchanged') }
            ]);
            validateIndex(read);
        });

        it('holds the books of its tenant alone', async () => {
            const books: PostingBooks = await createSeededBooks();
            const other: PostingBooks = await createSeededBooks();

            const read: ReadExport = await exportYear(books.tenantId, books.fiscalYear.id);

            const text: string = [...read.tables.values()].flat(2).join(' ');
            expect(text).not.toContain(other.fiscalYear.id);
            for (const account of Object.values(other.accounts)) {
                expect(text).not.toContain(account.id);
            }
            const otherEntries: JournalEntry[] = await inTenant(other.tenantId, async () => await inject<Repository<JournalEntry>>(repositoryTokenFor(JournalEntry))
                .findAll({ limit: 'all' }));
            for (const entry of otherEntries) {
                expect(text).not.toContain(entry.id);
            }
            await expect(inTenant(books.tenantId, async () => await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.EXPORT_SERVICE)
                .exportFiscalYear(other.fiscalYear.id))).rejects.toThrow(NotFoundError);
        });
    });
}
