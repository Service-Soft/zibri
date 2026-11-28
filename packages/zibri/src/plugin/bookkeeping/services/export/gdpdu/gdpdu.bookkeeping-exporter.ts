import { Injectable } from '../../../../../di/decorators/injectable.decorator';
import { XmlUtilities } from '../../../../../document/xml.utilities';
import { InternalError } from '../../../../../error-handling/internal-error.model';
import { MimeType } from '../../../../../http/mime-type.enum';
import { $ts } from '../../../../../localization/translate.function';
import { BigNumber } from '../../../../../utilities/number.utilities';
import { type ZipEntry, ZipUtilities } from '../../../../../utilities/zip.utilities';
import { BookkeepingDayUtilities } from '../../../bookkeeping-day.utilities';
import { type BookkeepingExportArchive } from '../../../models/bookkeeping-export-archive.model';
import { BookkeepingExportColumnType } from '../../../models/bookkeeping-export-column-type.enum';
import { type BookkeepingExportColumn } from '../../../models/bookkeeping-export-column.model';
import { type BookkeepingExportContent } from '../../../models/bookkeeping-export-content.model';
import { type BookkeepingExportTable } from '../../../models/bookkeeping-export-table.model';
import { type BookkeepingExportValue } from '../../../models/bookkeeping-export-value.type';
import { type FiscalYear } from '../../../models/fiscal-year.model';
import { type BookkeepingExporterInterface } from '../bookkeeping-exporter.interface';
import { type GdpduColumn } from './gdpdu-column.model';
import { GdpduDataSet } from './gdpdu-data-set.model';
import { type GdpduTable } from './gdpdu-table.model';

/**
 * The document type definition of the description standard, which `index.xml` names and an auditor puts beside it.
 */
const GDPDU_DTD: string = 'gdpdu-01-09-2004.dtd';

/**
 * How the description standard writes days, and how the export writes them.
 */
const DAY_FORMAT: string = 'DD.MM.YYYY';

/**
 * The defaults of the description standard, which the files are written in and `index.xml` states: values separated
 * by a semicolon, text in double quotes, a decimal comma, and a dot grouping digits, which the numbers are written
 * without. Each record ends with CRLF.
 */
const COLUMN_DELIMITER: string = ';';
const TEXT_ENCAPSULATOR: string = '"';
const DECIMAL_SYMBOL: string = ',';
const DIGIT_GROUPING_SYMBOL: string = '.';
const RECORD_DELIMITER: string = '\r\n';

/**
 * How many characters of a table are written in one piece.
 */
const PIECE_LENGTH: number = 64 * 1024;

/**
 * Writes the export of a fiscal year in the description standard the German tax administration publishes for the
 * data handed over in a tax audit (Beschreibungsstandard für die Datenüberlassung): a zip archive with a CSV file per
 * table, the documents in their folders, and an `index.xml` describing each table and column, which the audit
 * software reads.
 */
@Injectable({ register: 'onUse' })
export class GdpduBookkeepingExporter implements BookkeepingExporterInterface {
    // eslint-disable-next-line jsdoc/require-jsdoc
    resolveArchive(content: BookkeepingExportContent): BookkeepingExportArchive {
        return {
            fileName: `gobd-export-${this.resolveYearName(content.fiscalYear)}.zip`,
            mimeType: MimeType.ZIP,
            content: ZipUtilities.pack(this.resolveEntries(content))
        };
    }

    /**
     * The files of the archive: each table as CSV and each document, as they come, and `index.xml` last.
     * @param content - What the export holds.
     * @yields The files.
     */
    protected async* resolveEntries(content: BookkeepingExportContent): AsyncGenerator<ZipEntry> {
        const tables: BookkeepingExportTable[] = [];
        for await (const file of content.files) {
            switch (file.kind) {
                case 'table': {
                    this.validatePrimaryKey(file);
                    tables.push(file);
                    yield { name: `${file.name}.csv`, modifiedAt: content.exportedAt, content: this.resolveCsv(file) };
                    break;
                }
                case 'document': {
                    yield { name: file.path, modifiedAt: content.exportedAt, content: file.content };
                    break;
                }
            }
        }
        const index: string = await XmlUtilities.generateFrom(GdpduDataSet, this.resolveIndex(content, tables), {
            indent: true,
            doctypeSystemId: GDPDU_DTD
        });
        yield { name: 'index.xml', modifiedAt: content.exportedAt, content: this.resolvePieces(Buffer.from(index, 'utf8')) };
    }

    /**
     * The description of the export, as `index.xml` holds it.
     * @param content - What the export holds.
     * @param tables - Its tables.
     * @returns The description.
     */
    protected resolveIndex(content: BookkeepingExportContent, tables: BookkeepingExportTable[]): GdpduDataSet {
        const start: string = this.formatDay(content.fiscalYear.start);
        const end: string = this.formatDay(content.fiscalYear.end);
        return {
            version: '1.0',
            dataSupplier: {
                name: content.settings.company?.name ?? '',
                location: content.settings.company?.seat ?? '',
                comment: this.resolveComment(content)
            },
            media: [{
                name: $ts`Books of the fiscal year from ${start} to ${end}`,
                tables: tables.map(table => this.resolveTable(table, content.fiscalYear))
            }]
        };
    }

    /**
     * What the description says of the export: its fiscal year, when it was written, and what checking the books
     * found, which a broken chain states first.
     * @param content - What the export holds.
     * @returns The comment.
     */
    protected resolveComment(content: BookkeepingExportContent): string {
        const start: string = this.formatDay(content.fiscalYear.start);
        const end: string = this.formatDay(content.fiscalYear.end);
        const exportedAt: string = content.exportedAt.toISOString();
        if (!content.verification.intact) {
            return $ts`Checking the books found that the chains of the journal entries and of their lines, or the balance of an entry, do not hold, see verification-problems. The rows are exported as they are. Books of the fiscal year from ${start} to ${end}, exported at ${exportedAt}.`;
        }
        return $ts`Books of the fiscal year from ${start} to ${end}, exported at ${exportedAt}. Checking the books found the chains of the journal entries and of their lines intact, and every entry balanced, see verification.`;
    }

    /**
     * The description of one table.
     * @param table - The table.
     * @param fiscalYear - The fiscal year it is valid for.
     * @returns The description.
     */
    protected resolveTable(table: BookkeepingExportTable, fiscalYear: FiscalYear): GdpduTable {
        const columns: GdpduColumn[] = table.columns.map(column => this.resolveColumn(column));
        const keyed: boolean = table.primaryKey != undefined;
        return {
            url: `${table.name}.csv`,
            name: table.name,
            description: table.description,
            validity: {
                range: { from: this.formatDay(fiscalYear.start), to: this.formatDay(fiscalYear.end) },
                format: DAY_FORMAT
            },
            utf8: {},
            decimalSymbol: DECIMAL_SYMBOL,
            digitGroupingSymbol: DIGIT_GROUPING_SYMBOL,
            // the first record is the header naming the columns
            range: { from: '2' },
            variableLength: {
                columnDelimiter: COLUMN_DELIMITER,
                textEncapsulator: TEXT_ENCAPSULATOR,
                primaryKeys: keyed ? columns.slice(0, 1) : [],
                columns: keyed ? columns.slice(1) : columns,
                foreignKeys: table.foreignKeys.map(key => ({
                    names: [key.column],
                    references: key.table,
                    aliases: [{ from: key.column, to: 'id' }]
                }))
            }
        };
    }

    /**
     * The description of one column, by the kind of its values.
     * @param column - The column.
     * @returns The description.
     */
    protected resolveColumn(column: BookkeepingExportColumn): GdpduColumn {
        const described: Pick<GdpduColumn, 'name' | 'description'> = { name: column.name, description: column.description };
        switch (column.type) {
            case BookkeepingExportColumnType.NUMBER: {
                return { ...described, numeric: { accuracy: column.decimals ?? 0 } };
            }
            case BookkeepingExportColumnType.TEXT: {
                return { ...described, alphaNumeric: {} };
            }
            case BookkeepingExportColumnType.DAY: {
                return { ...described, date: { format: DAY_FORMAT } };
            }
        }
    }

    /**
     * Writes a table as CSV: a header naming the columns, then a record per row.
     * @param table - The table.
     * @yields The file, in pieces of about 64 KiB.
     */
    protected async* resolveCsv(table: BookkeepingExportTable): AsyncGenerator<Buffer> {
        let pending: string = this.resolveRecord(table.columns.map(column => this.formatText(column.name)));
        for await (const row of table.rows) {
            if (row.length !== table.columns.length) {
                throw new InternalError(`A row of the table ${table.name} has ${row.length} values, and the table ${table.columns.length} columns.`);
            }
            pending += this.resolveRecord(row.map((value, index) => this.formatValue(value, table.columns[index], table)));
            if (pending.length >= PIECE_LENGTH) {
                yield Buffer.from(pending, 'utf8');
                pending = '';
            }
        }
        yield Buffer.from(pending, 'utf8');
    }

    /**
     * Writes a value as its column holds it: a number with a decimal comma and without grouped digits, a day as
     * `DD.MM.YYYY`, text in double quotes, and nothing for none.
     * @param value - The value.
     * @param column - Its column.
     * @param table - Its table, to name in an error.
     * @returns The value as CSV.
     * @throws An InternalError for a value its column does not hold.
     */
    protected formatValue(value: BookkeepingExportValue, column: BookkeepingExportColumn | undefined, table: BookkeepingExportTable): string {
        if (value == undefined) {
            return '';
        }
        switch (column?.type) {
            case BookkeepingExportColumnType.NUMBER: {
                if (typeof value === 'number' || value instanceof BigNumber) {
                    return new BigNumber(value).toFixed(column.decimals ?? 0).replace('.', DECIMAL_SYMBOL);
                }
                break;
            }
            case BookkeepingExportColumnType.DAY: {
                if (value instanceof Date) {
                    return this.formatDay(value);
                }
                break;
            }
            case BookkeepingExportColumnType.TEXT: {
                if (typeof value === 'string') {
                    return this.formatText(value);
                }
                break;
            }
            case undefined: {
                break;
            }
        }
        throw new InternalError(`The column ${column?.name} of the table ${table.name} does not hold the value ${String(value)}.`);
    }

    /**
     * Writes text in double quotes, a double quote in it doubled. A line break becomes a space, as the audit software
     * ends a record at each.
     * @param value - The text.
     * @returns The text as CSV.
     */
    protected formatText(value: string): string {
        const text: string = value.replaceAll(/\r\n|\r|\n/g, ' ').replaceAll(TEXT_ENCAPSULATOR, `${TEXT_ENCAPSULATOR}${TEXT_ENCAPSULATOR}`);
        return `${TEXT_ENCAPSULATOR}${text}${TEXT_ENCAPSULATOR}`;
    }

    /**
     * Writes a day as `DD.MM.YYYY`.
     * @param day - The day, at midnight UTC.
     * @returns The day, such as `31.12.2026`.
     */
    protected formatDay(day: Date): string {
        const [year, month, date] = BookkeepingDayUtilities.formatDay(day).split('-');
        return `${date}.${month}.${year}`;
    }

    /**
     * How the file of the export of a fiscal year is named: by its calendar year, or by its first and its last day
     * for a fiscal year that is not one.
     * @param fiscalYear - The fiscal year.
     * @returns The name, such as `2026` or `2025-07-01-2026-06-30`.
     */
    protected resolveYearName(fiscalYear: FiscalYear): string {
        const start: string = BookkeepingDayUtilities.formatDay(fiscalYear.start);
        const end: string = BookkeepingDayUtilities.formatDay(fiscalYear.end);
        const year: string = start.slice(0, 4);
        return start === `${year}-01-01` && end === `${year}-12-31` ? year : `${start}-${end}`;
    }

    private resolveRecord(values: string[]): string {
        return `${values.join(COLUMN_DELIMITER)}${RECORD_DELIMITER}`;
    }

    private validatePrimaryKey(table: BookkeepingExportTable): void {
        // the standard lists the columns of the primary key before the others, in the order of the file
        if (table.primaryKey != undefined && table.columns[0]?.name !== table.primaryKey) {
            throw new InternalError(`The primary key ${table.primaryKey} of the table ${table.name} needs to be its first column.`);
        }
    }

    private async* resolvePieces(...pieces: Buffer[]): AsyncGenerator<Buffer> {
        for (const piece of pieces) {
            yield await Promise.resolve(piece);
        }
    }
}
