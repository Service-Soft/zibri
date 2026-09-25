import { DataSourceInterface, Newable } from 'zibri';

/**
 * A stored row, holding one json encoded value per column.
 *
 * Encoded rather than kept as the object that was handed in, for two reasons. It isolates the store
 * from its callers, so an entity a test mutates after saving it cannot reach back into what is
 * stored. And it puts every value through the same narrowing a real store applies - a Date comes
 * back as a Date, a bigint as a bigint, a Buffer as a Buffer - rather than handing the original
 * instance back and hiding every place production code depends on that conversion.
 */
export type StoredRow = Record<string, string>;

/**
 * The whole content of a store, in the shape a backup carries it.
 */
export type InMemoryStoreSnapshot = {
    /**
     * Every stored row, by table name and then by id.
     */
    tables: Record<string, Record<string, StoredRow>>,
    /**
     * The members of every many to many join, by join key.
     */
    joins: Record<string, string[]>,
    /**
     * The last value handed out per table, for entities with a numeric primary key.
     */
    sequences: Record<string, number>
};

/**
 * What a driver reads and writes through, whether or not there is a transaction.
 *
 * Both the store itself and a transaction on it answer this, so a driver resolves one of them once
 * and never branches on which it got. The operations are synchronous on purpose - see
 * {@link InMemoryStore}.
 */
export interface InMemoryScope {
    /**
     * Reads one row, or undefined when the table does not hold that id.
     */
    readRow: (tableName: string, id: string) => StoredRow | undefined,
    /**
     * Lists the ids the table holds.
     */
    ids: (tableName: string) => string[],
    /**
     * Writes one row, replacing whatever the id held.
     */
    writeRow: (tableName: string, id: string, row: StoredRow) => void,
    /**
     * Removes one row.
     */
    deleteRow: (tableName: string, id: string) => void,
    /**
     * Reads the members of one many to many join.
     */
    readJoin: (key: string) => Set<string>,
    /**
     * Replaces the members of one many to many join.
     */
    writeJoin: (key: string, members: Set<string>) => void,
    /**
     * Hands out the next number for a table whose primary key is numeric.
     */
    nextSequenceValue: (tableName: string) => number
}

/**
 * The storage behind an in memory data source: rows, joins and sequences held in maps.
 *
 * ## Why every operation is synchronous
 * Nothing here goes anywhere, so nothing here needs to be awaited - and that is what makes the
 * driver above it atomic without holding anything. A read followed by a write is the shape every
 * store has to protect (see `RepositoryDriverInterface.upsert`), and the real ones protect it with a
 * grant per key because another process can write between the two. Here there is no other process,
 * and with no `await` between the read and the write there is not even another task: the runtime
 * cannot interleave anything into a synchronous sequence. So a lock would guard a window that does
 * not exist.
 *
 * This is the one place that is load bearing rather than convenient. If an operation in here ever
 * becomes async, every read-modify-write above it silently stops being atomic.
 */
export class InMemoryStore implements InMemoryScope {

    private readonly tables: Map<string, Map<string, StoredRow>> = new Map();

    private readonly joins: Map<string, Set<string>> = new Map();

    private readonly sequences: Map<string, number> = new Map();

    /**
     * The rows of one table, created on first use.
     * @param tableName - The table to read.
     * @returns The rows by id. The live map, so a caller may iterate it but must not keep it.
     */
    private rowsOf(tableName: string): Map<string, StoredRow> {
        const existing: Map<string, StoredRow> | undefined = this.tables.get(tableName);
        if (existing) {
            return existing;
        }
        const created: Map<string, StoredRow> = new Map();
        this.tables.set(tableName, created);
        return created;
    }

    /**
     * Reads one row.
     * @param tableName - The table the row is in.
     * @param id - The id of the row.
     * @returns The row, or undefined when there is none.
     */
    readRow(tableName: string, id: string): StoredRow | undefined {
        return this.rowsOf(tableName).get(id);
    }

    /**
     * The ids of every row in a table.
     * @param tableName - The table to list.
     * @returns The ids.
     */
    ids(tableName: string): string[] {
        return [...this.rowsOf(tableName).keys()];
    }

    /**
     * Writes one row, replacing whatever was stored under that id.
     * @param tableName - The table the row belongs to.
     * @param id - The id of the row.
     * @param row - The values to store.
     */
    writeRow(tableName: string, id: string, row: StoredRow): void {
        this.rowsOf(tableName).set(id, row);
    }

    /**
     * Removes one row.
     * @param tableName - The table the row is in.
     * @param id - The id of the row.
     */
    deleteRow(tableName: string, id: string): void {
        this.rowsOf(tableName).delete(id);
    }

    /**
     * Reads the members of a many to many relation.
     * @param key - The key the relation is stored under.
     * @returns A copy of the ids on the other side of it, so a caller cannot change what is stored.
     */
    readJoin(key: string): Set<string> {
        return new Set(this.joins.get(key));
    }

    /**
     * Writes the members of a many to many relation.
     * @param key - The key the relation is stored under.
     * @param members - The ids on the other side of it. An empty set removes the relation.
     */
    writeJoin(key: string, members: Set<string>): void {
        if (!members.size) {
            // dropped rather than kept empty, so a snapshot carries the joins that exist rather than
            // every join that has ever existed
            this.joins.delete(key);
            return;
        }
        this.joins.set(key, new Set(members));
    }

    /**
     * Hands out the next number for a table whose primary key is numeric.
     * @param tableName - The table the row is being inserted into.
     * @returns The next number, which no other caller receives.
     */
    nextSequenceValue(tableName: string): number {
        const next: number = (this.sequences.get(tableName) ?? 0) + 1;
        this.sequences.set(tableName, next);
        return next;
    }

    /**
     * Copies everything the store holds out of it.
     * @returns The snapshot, sharing nothing with the store it was taken from.
     */
    snapshot(): InMemoryStoreSnapshot {
        const tables: Record<string, Record<string, StoredRow>> = {};
        for (const [tableName, rows] of this.tables) {
            tables[tableName] = Object.fromEntries([...rows].map(([id, row]) => [id, { ...row }]));
        }
        const joins: Record<string, string[]> = {};
        for (const [key, members] of this.joins) {
            joins[key] = [...members];
        }
        return { tables, joins, sequences: Object.fromEntries(this.sequences) };
    }

    /**
     * Replaces everything the store holds with the given snapshot.
     *
     * A replacement rather than a merge, which is what restoring a backup means: rows written since
     * the backup was taken are not in it and do not survive it.
     * @param snapshot - The content to restore.
     */
    restore(snapshot: InMemoryStoreSnapshot): void {
        this.clear();
        for (const [tableName, rows] of Object.entries(snapshot.tables)) {
            const table: Map<string, StoredRow> = this.rowsOf(tableName);
            for (const [id, row] of Object.entries(rows)) {
                table.set(id, { ...row });
            }
        }
        for (const [key, members] of Object.entries(snapshot.joins)) {
            this.joins.set(key, new Set(members));
        }
        for (const [tableName, value] of Object.entries(snapshot.sequences)) {
            this.sequences.set(tableName, value);
        }
    }

    /**
     * Drops everything the store holds.
     */
    clear(): void {
        this.tables.clear();
        this.joins.clear();
        this.sequences.clear();
    }
}

/**
 * The store of every in memory data source class that has one.
 *
 * Keyed by the class rather than held on the instance, because the class is what outlives a restart.
 * Re-initializing an application discards its di container and therefore every data source object in
 * it, while the *classes* it boots with are the same ones - so an instance owning its store would
 * hand the next one an empty database, which is not what restarting a deployment does.
 *
 * A container-backed data source gets this for free: the container keeps running across a re-init
 * because nothing stopped it. This map is the equivalent, and the two lifetimes line up - a new
 * server takes a new container, so it also takes a new store, via {@link resetInMemoryStore}.
 */
const stores: Map<Newable<DataSourceInterface>, InMemoryStore> = new Map();

/**
 * The store the given data source class reads and writes, created on first use.
 * @param dataSourceClass - The class to resolve the store for.
 * @returns Its store, the same one every instance of that class shares.
 */
export function inMemoryStoreFor(dataSourceClass: Newable<DataSourceInterface>): InMemoryStore {
    const existing: InMemoryStore | undefined = stores.get(dataSourceClass);
    if (existing) {
        return existing;
    }
    const created: InMemoryStore = new InMemoryStore();
    stores.set(dataSourceClass, created);
    return created;
}

/**
 * Gives the given data source class an empty store, discarding whatever the old one held.
 *
 * For whoever starts a *new* server rather than re-initializing one, which is the moment a
 * container-backed data source would get a new container. A test harness calls this as it boots; a
 * re-init deliberately does not, which is the whole of how the rows survive one.
 *
 * Only needed by a suite that boots more than one server on the same data source class. A harness
 * that builds a class per server - as `createTestDataSource` does - already gets a store per server,
 * because a class nothing has asked about yet has no store to inherit.
 * @param dataSourceClass - The class to reset the store of.
 * @returns The new, empty store.
 */
export function resetInMemoryStore(dataSourceClass: Newable<DataSourceInterface>): InMemoryStore {
    const created: InMemoryStore = new InMemoryStore();
    stores.set(dataSourceClass, created);
    return created;
}