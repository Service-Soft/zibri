import { Repository } from '../../../data-source/repository/repository';
import { PromiseUtilities } from '../../../utilities/promise.utilities';
import { MeasuredRow } from './measured-row.model';
import { SeededChanges, SeededFingerprint, SeededRow, SeededTable } from './seeded-table.model';

/**
 * How many rows are written or read in one call.
 */
const BATCH_ROWS: number = 1000;

/**
 * How many of those calls run at once while writing.
 */
const WRITE_CONCURRENCY: number = 4;

/**
 * The rows of a {@link SeededTable} in a data source, kept in line with the table.
 *
 * Remembers the id each row was stored under, so that every read and delete goes by the primary key,
 * which every store looks up directly. Filtered by `rowId` instead, a store without an index to range
 * over read every row for each page, and checking 100 MB in valkey took over four minutes.
 */
export class MeasuredRowStore {
    /**
     * The id each row of the table is stored under, by its id in the table.
     */
    private readonly storedIds: Map<number, string> = new Map();

    /**
     * Creates a store that knows none of the ids of the rows yet.
     * @param repository - Where the rows are stored.
     */
    constructor(private readonly repository: Repository<MeasuredRow>) {}

    /**
     * The id each row is stored under now, to read what was stored at this moment later.
     * @returns A copy, by the id of the row in the table.
     */
    getStoredIds(): Map<number, string> {
        return new Map(this.storedIds);
    }

    /**
     * Writes rows that are not stored yet, a few batches at a time.
     * @param rows - The rows.
     */
    async writeRows(rows: Iterable<SeededRow>): Promise<void> {
        let batches: Omit<MeasuredRow, 'id'>[][] = [];
        let batch: Omit<MeasuredRow, 'id'>[] = [];
        for (const row of rows) {
            batch.push({ rowId: row.id, version: row.version, text: row.text });
            if (batch.length === BATCH_ROWS) {
                batches.push(batch);
                batch = [];
            }
            if (batches.length === WRITE_CONCURRENCY) {
                await this.createAll(batches);
                batches = [];
            }
        }
        await this.createAll([...batches, ...batch.length ? [batch] : []]);
    }

    /**
     * Writes the changes of the table into the data source.
     * @param changes - What changed.
     */
    async applyChanges(changes: SeededChanges): Promise<void> {
        // a written row replaces what was stored for it, as an update would
        const removed: string[] = [...changes.deletedIds, ...changes.written.map(row => row.id)]
            .flatMap(rowId => {
                const id: string | undefined = this.storedIds.get(rowId);
                this.storedIds.delete(rowId);
                return id == undefined ? [] : [id];
            });
        for (const ids of PromiseUtilities.resolveChunks(removed, BATCH_ROWS)) {
            await this.repository.deleteAll({ id: { oneOf: ids } });
        }
        await this.writeRows(changes.written);
    }

    /**
     * What the data source holds of the given rows, the way {@link SeededTable.resolveFingerprint} says
     * it of a table: their content, and how many rows it holds in all, so that a row that should not
     * be there shows as well as one that is missing or different.
     * @param storedIds - The rows to read, by their id in the table: those stored now when not given.
     * @returns The fingerprint.
     */
    async resolveFingerprint(storedIds: Map<number, string> = this.storedIds): Promise<SeededFingerprint> {
        const fingerprint: SeededFingerprint = await SeededTable.resolveFingerprintOf(this.readRows(storedIds));
        return { ...fingerprint, rows: await this.repository.count() };
    }

    /**
     * Reads the given rows, a batch at a time, in the order of their ids in the table.
     * @param storedIds - The rows, by their id in the table.
     * @yields Each row that is stored.
     */
    private async* readRows(storedIds: Map<number, string>): AsyncGenerator<SeededRow> {
        const rowIds: number[] = [...storedIds.keys()].sort((a, b) => a - b);
        for (const page of PromiseUtilities.resolveChunks(rowIds, BATCH_ROWS)) {
            const ids: string[] = page.flatMap(rowId => storedIds.get(rowId) ?? []);
            const rows: MeasuredRow[] = await this.repository.findAll({ where: { id: { oneOf: ids } }, limit: BATCH_ROWS });
            for (const row of rows.sort((a, b) => a.rowId - b.rowId)) {
                yield { id: row.rowId, version: row.version, text: row.text };
            }
        }
    }

    /**
     * Creates batches of rows at once, and remembers the id each row got.
     * @param batches - The batches.
     */
    private async createAll(batches: Omit<MeasuredRow, 'id'>[][]): Promise<void> {
        const created: MeasuredRow[][] = await Promise.all(batches.map(async b => await this.repository.createAll(b)));
        for (const row of created.flat()) {
            this.storedIds.set(row.rowId, row.id);
        }
    }
}