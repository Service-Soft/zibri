import { PostgresColumnSql } from './postgres-column-sql.model';
import { PostgresColumnSettings, PostgresSchema } from './postgres-schema.model';
import { PostgresSqlUtilities } from './postgres-sql.utilities';
import { PostgresColumn, PostgresForeignKey, PostgresKey, PostgresReferentialAction, PostgresTable } from './postgres-table.model';
import { PostgresValueConversionUtilities } from './postgres-value-conversion.utilities';
import { TrigramSupport } from './postgres-where-filter.converter';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { PropertyMetadata } from '../../../entity/decorators/property.decorator';
import { coversEveryRow, KeyWhere } from '../../../entity/models/unique-declaration.model';
import { InternalError } from '../../../error-handling/internal-error.model';
import { KeyGroups, keyGroupsOf } from '../../../global/model-registry/key-descriptor';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { Newable } from '../../../types/newable.type';
import { MetadataUtilities } from '../../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../../utilities/object.utilities';
import { checkConstraintName } from '../../check-constraint-name.function';
import { CheckConstraintViolationError } from '../../check-constraint-violation.error';
import { indexName, trigramIndexName, TRIGRAM_INDEX_PREFIX } from '../../index-name.function';
import { literalToSql } from '../../literal-to-sql.function';
import { MigratedEntityUtilities, MovedEntity } from '../../migration/migrated-entity.utilities';
import { ConversionRefusal } from '../../models/conversion-refusal.enum';
import { MigrationPropertyMetadata } from '../../models/migration-property-metadata.model';
import { RefusedValue } from '../../models/refused-value.model';
import { ResolvedPropertyConversion } from '../../models/resolved-property-conversion.model';
import { FuzzySearchUtilities } from '../../models/where/fuzzy-search.utilities';
import { uniqueConstraintName } from '../../unique-constraint-name.function';
import { ValueConversionUtilities } from '../../value-conversion.utilities';
import { keyWhereToSql } from '../../where/key-where-to-sql.function';

/**
 * Runs one statement on the connection the schema work is done on.
 */
export type PostgresRun = (sql: string, values?: unknown[]) => Promise<Record<string, unknown>[]>;

/**
 * One statement synchronizing runs.
 */
export type SynchronizeStep = {
    /**
     * The statement.
     */
    sql: string,
    /**
     * What runs instead, when the statement fails.
     */
    otherwise?: string[]
};

/**
 * A join table an entity takes part in, as it is stored and as it is stored afterwards.
 */
type RenamedJoinTable = {
    /**
     * The join table as it is stored now.
     */
    current: PostgresTable,
    /**
     * The join table as it is stored afterwards.
     */
    renamed: PostgresTable,
    /**
     * The columns referring to the renamed entity, as they are named now.
     */
    entityColumns: string[]
};

/**
 * A unique a merged row must not break, by the columns it covers.
 */
type MergedUnique = {
    /**
     * The columns it covers.
     */
    columns: string[],
    /**
     * The rows it covers, as sql, or undefined when it covers every row.
     */
    where: string | undefined
};

/**
 * One index of a table, as postgres lists it for keeping the declared ones.
 */
type StoredKeyRow = {
    /**
     * The table it is on.
     */
    table: string,
    /**
     * The name of the index.
     */
    name: string,
    /**
     * Whether it is complete. A concurrent build that failed leaves its index behind invalid.
     */
    valid: boolean,
    /**
     * Whether a unique constraint is enforced through it.
     */
    constraint: boolean,
    /**
     * Whether it carries {@link DECLARED_KEY_COMMENT}, which says the data source created it.
     */
    marked: boolean
};

/**
 * One check constraint of a table, as postgres lists it for keeping the declared ones.
 */
type StoredCheckRow = {
    /**
     * The table it is on.
     */
    table: string,
    /**
     * Its name.
     */
    name: string,
    /**
     * Whether the rows stored before it was added were checked against it.
     */
    valid: boolean
};

/**
 * An index or unique an entity declares, as the statements that create it.
 */
type DeclaredKey = {
    /**
     * Its name.
     */
    name: string,
    /**
     * The properties it covers.
     */
    properties: string[],
    /**
     * Builds the index, concurrently.
     */
    build: string,
    /**
     * Builds the index in one go, on a table that holds no rows yet.
     */
    buildOnEmptyTable: string,
    /**
     * Makes a unique over every row a constraint, through the index once it is built.
     */
    constrain: string | undefined,
    /**
     * Finds values more than one row holds, for a unique.
     */
    duplicates: string | undefined
};

/**
 * A constraint of a table, as postgres lists it.
 */
type StoredConstraintRow = {
    /**
     * The table it is on.
     */
    table: string,
    /**
     * Its name.
     */
    name: string,
    /**
     * `p` for a primary key, `f` for a foreign key, `u` for a unique.
     */
    kind: string,
    /**
     * Its columns, in order.
     */
    columns: string[],
    /**
     * The table a foreign key refers to, undefined for any other kind of constraint.
     */
    referencedTable: string | undefined,
    /**
     * The columns a foreign key refers to.
     */
    referencedColumns: string[],
    /**
     * What a foreign key does once a referred row is deleted: `c` cascades.
     */
    onDelete: string,
    /**
     * What it does once the key of a referred row changes: `c` cascades.
     */
    onUpdate: string
};

/**
 * The comment on every index the data source creates for what an entity declares, which tells its own
 * indexes apart from everybody else's on the same table.
 */
const DECLARED_KEY_COMMENT: string = 'Kept by zibri as an entity declares it, and dropped once none does.';

/**
 * Whether an index is named the way typeorm named one by default, which is how 2.x named the indexes
 * and uniques an entity declared.
 */
const ORM_DEFAULT_KEY_NAME_PATTERN: RegExp = /^(UQ_[\da-f]{27}|IDX_[\da-f]{26})$/;

/**
 * Whether a foreign key is named the way the data source names the one of a relation, which is how
 * typeorm named it: a foreign key named otherwise is somebody else's.
 */
const OWNED_FOREIGN_KEY_NAME_PATTERN: RegExp = /^FK_[\da-f]{27}$/;

/**
 * The longest name postgres keeps, in bytes. A longer one is cut to this when it is created.
 */
const MAX_IDENTIFIER_BYTES: number = 63;

/**
 * A cast postgres writes after a default it lists, such as `::character varying`.
 */
const TRAILING_CAST_PATTERN: RegExp = /::[a-z][ a-z]*(\(\d+(,\d+)?\))?(\[])?$/i;

/**
 * Lists the columns of tables in the current schema.
 */
const STORED_COLUMNS_SQL: string = `
    SELECT t.relname AS "table", a.attname AS "name", format_type(a.atttypid, a.atttypmod) AS "type",
        NOT a.attnotnull AS "nullable", pg_get_expr(d.adbin, d.adrelid) AS "default",
        CASE WHEN co.collname = 'default' THEN NULL ELSE co.collname END AS "collation"
    FROM pg_attribute a
    JOIN pg_class t ON t.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    LEFT JOIN pg_collation co ON co.oid = a.attcollation
    WHERE n.nspname = current_schema() AND t.relkind IN ('r', 'p') AND t.relname = ANY($1) AND a.attnum > 0 AND NOT a.attisdropped
    ORDER BY a.attnum
`;

/**
 * Lists the primary keys, foreign keys and uniques of tables in the current schema.
 */
const STORED_CONSTRAINTS_SQL: string = `
    SELECT t.relname AS "table", c.conname AS "name", c.contype AS "kind",
        ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(num, pos)
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.num ORDER BY k.pos)::text[] AS "columns",
        rt.relname AS "referencedTable",
        ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(num, pos)
            JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.num ORDER BY k.pos)::text[] AS "referencedColumns",
        c.confdeltype AS "onDelete", c.confupdtype AS "onUpdate"
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    LEFT JOIN pg_class rt ON rt.oid = c.confrelid
    WHERE n.nspname = current_schema() AND t.relname = ANY($1) AND c.contype IN ('p', 'f', 'u')
`;

/**
 * Lists the indexes of tables in the current schema, and whether each carries the given comment.
 */
const STORED_KEYS_SQL: string = `
    SELECT t.relname AS "table", i.relname AS "name", x.indisvalid AS "valid", c.conname IS NOT NULL AS "constraint",
        coalesce(obj_description(i.oid, 'pg_class') = $2, false) AS "marked"
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    LEFT JOIN pg_constraint c ON c.conindid = x.indexrelid AND c.contype = 'u'
    WHERE n.nspname = current_schema() AND t.relname = ANY($1)
`;

/**
 * Lists the check constraints of tables in the current schema.
 */
const STORED_CHECKS_SQL: string = `
    SELECT t.relname AS "table", c.conname AS "name", c.convalidated AS "valid"
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.contype = 'c' AND n.nspname = current_schema() AND t.relname = ANY($1)
`;

/**
 * Lists the triggers on tables in the current schema, and the foreign keys pointing at its tables that
 * change the rows pointing at a row once it is removed or its key changes.
 */
const CHANGING_DEPENDENTS_SQL: string = `
    SELECT t.relname AS "table", 'trigger' AS "kind", g.tgname AS "name",
        NULL AS "dependent", NULL AS "onDelete", NULL AS "onUpdate"
    FROM pg_trigger g
    JOIN pg_class t ON t.oid = g.tgrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE NOT g.tgisinternal AND n.nspname = current_schema()
    UNION ALL
    SELECT rt.relname AS "table", 'foreign key' AS "kind", c.conname AS "name",
        t.relname AS "dependent", c.confdeltype::text AS "onDelete", c.confupdtype::text AS "onUpdate"
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_class rt ON rt.oid = c.confrelid
    JOIN pg_namespace n ON n.oid = rt.relnamespace
    WHERE c.contype = 'f' AND n.nspname = current_schema()
        AND (c.confdeltype IN ('c', 'n', 'd') OR c.confupdtype IN ('c', 'n', 'd'))
`;

/**
 * Makes the schema of a postgres data source what its entities and its migrations say: the tables,
 * columns and keys, and the indexes, uniques and checks the entities declare.
 */
export class PostgresSchemaManager {

    /**
     * The tables the migrations of this boot created, which nothing has read or written but them.
     */
    private readonly createdByMigrations: Set<string> = new Set();

    constructor(
        private readonly schema: PostgresSchema,
        private readonly settings: PostgresColumnSettings,
        private readonly entities: Newable<BaseEntity>[],
        private readonly trigram: TrigramSupport,
        private readonly logger: LoggerInterface
    ) {}

    /**
     * The name postgres stores for a given one.
     * @param name - The name.
     * @returns It, cut to what postgres keeps.
     */
    static toStoredIdentifier(name: string): string {
        const bytes: Buffer = Buffer.from(name);
        return bytes.length <= MAX_IDENTIFIER_BYTES ? name : bytes.subarray(0, MAX_IDENTIFIER_BYTES).toString();
    }

    /**
     * Finds the properties the unique an entity declares under a name covers, its primary key included.
     * @param entity - The entity.
     * @param name - The name of the unique, as postgres stores it.
     * @returns The properties, or undefined when the entity declares no unique of that name.
     */
    findDeclaredUnique(entity: Newable<BaseEntity>, name: string): string[] | undefined {
        return this.resolveDeclaredKeys(entity)
            .find(k => k.duplicates != undefined && PostgresSchemaManager.toStoredIdentifier(k.name) === name)?.properties
            ?? (name === this.schema.getTable(entity).primaryKey.name ? ['id'] : undefined);
    }

    /**
     * Finds the check an entity declares under a name.
     * @param entity - The entity.
     * @param name - The name of the check, as postgres stores it.
     * @returns Its condition, or undefined when the entity declares no check of that name.
     */
    findDeclaredCheck(entity: Newable<BaseEntity>, name: string): KeyWhere | undefined {
        const tableName: string = this.schema.getTable(entity).name;
        return MetadataUtilities.getEntityMetadata(entity)?.checks?.find(
            check => PostgresSchemaManager.toStoredIdentifier(checkConstraintName(tableName, keyWhereToSql(entity, check.where))) === name
        )?.where;
    }

    // ── synchronizing ───────────────────────────────────────────

    /**
     * Alters the database to match the entities: creates the tables that are missing, adds, changes and
     * drops columns, and keeps the keys of the relations. A table is never dropped.
     * @param run - Runs a statement on the connection the schema is set up on.
     */
    async synchronize(run: PostgresRun): Promise<void> {
        // the steps with nothing to fall back on go together, in one round trip that applies all of them
        // or none, so a boot creating every table costs what one finding them in place does
        let batch: string[] = [];
        const flush: () => Promise<void> = async () => {
            if (batch.length) {
                await run(batch.join(';\n'));
                batch = [];
            }
        };
        for (const step of await this.resolveSynchronizeSteps(run)) {
            if (step.otherwise == undefined) {
                batch.push(step.sql);
                continue;
            }
            await flush();
            try {
                await run(step.sql);
            }
            catch {
                for (const sql of step.otherwise) {
                    await run(sql);
                }
            }
        }
        await flush();
    }

    /**
     * Resolves the statements synchronizing runs, without running any of them.
     * @param run - Runs a statement, for reading what the database holds.
     * @returns The statements, in the order they run. Empty when the database matches the entities.
     */
    async resolveSynchronizeSteps(run: PostgresRun): Promise<SynchronizeStep[]> {
        const names: string[] = this.schema.tables.map(t => t.name);
        const columns: Record<string, unknown>[] = await run(STORED_COLUMNS_SQL, [names]);
        const constraints: StoredConstraintRow[] = await this.readConstraints(run, names);
        const indexes: Set<string> = new Set((await run(
            'SELECT indexname AS "name" FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ANY($1)',
            [names]
        )).map(row => String(row['name'])));
        const steps: SynchronizeStep[] = [];

        // a foreign key that is not wanted goes first, before what it refers to changes
        const wanted: Map<string, PostgresForeignKey> = new Map(this.schema.tables.flatMap(t => t.foreignKeys.map(fk => [fk.name, fk])));
        for (const stored of constraints.filter(c => c.kind === 'f')) {
            const fk: PostgresForeignKey | undefined = wanted.get(stored.name);
            if (fk == undefined || !this.isSameForeignKey(fk, stored)) {
                steps.push({ sql: `ALTER TABLE ${this.escape(stored.table)} DROP CONSTRAINT ${this.escape(stored.name)}` });
            }
            else {
                wanted.delete(stored.name);
            }
        }
        for (const table of this.schema.tables) {
            const stored: Record<string, unknown>[] = columns.filter(c => c['table'] === table.name);
            if (!stored.length) {
                steps.push(
                    ...[...this.resolveCreateTable(table, false), ...this.resolveDeclaredOnCreatedTable(table.name)].map(sql => ({ sql }))
                );
                continue;
            }
            steps.push(...this.resolveColumnSteps(table, stored));
            const name: string = this.escape(table.name);
            const uniques: StoredConstraintRow[] = constraints.filter(
                c => c.table === table.name && c.kind === 'u' && c.name.startsWith('REL_')
            );
            for (const unique of uniques.filter(u => !table.uniques.some(w => w.name === u.name))) {
                steps.push({ sql: `ALTER TABLE ${name} DROP CONSTRAINT ${this.escape(unique.name)}` });
            }
            for (const unique of table.uniques.filter(u => !uniques.some(s => s.name === u.name))) {
                steps.push({ sql: `ALTER TABLE ${name} ADD ${this.uniqueSql(unique)}` });
            }
            for (const index of table.indexes.filter(i => !indexes.has(i.name))) {
                steps.push({ sql: this.indexSql(table.name, index) });
            }
        }
        for (const fk of wanted.values()) {
            steps.push({ sql: this.foreignKeySql(this.findTableOf(fk), fk) });
        }
        return steps;
    }

    // ── relations ───────────────────────────────────────────────

    /**
     * Makes the relations of the entities' tables match what the entities declare, the way their
     * indexes and uniques are kept: creates every join table, foreign key and relation unique that is
     * missing, and drops every foreign key and relation unique the data source named that no entity
     * declares. A join table no entity declares holds relations, so removing one is a migration's.
     * @param run - Runs a statement on a session of its own, with no transaction.
     * @returns Whether anything was created or dropped.
     */
    async reconcileRelations(run: PostgresRun): Promise<boolean> {
        let changed: boolean = false;
        const joinTables: PostgresTable[] = this.schema.tables.filter(t => t.entityClass == undefined);
        const existing: Set<string> = await this.findExistingTables(run, joinTables.map(t => t.name));
        for (const table of joinTables.filter(t => !existing.has(t.name))) {
            await this.createTable(run, table);
            changed = true;
        }

        const names: string[] = this.schema.tables.map(t => t.name);
        const constraints: StoredConstraintRow[] = await this.readConstraints(run, names);
        const wanted: Map<string, PostgresForeignKey> = new Map(this.schema.tables.flatMap(t => t.foreignKeys.map(fk => [fk.name, fk])));
        for (const stored of constraints.filter(c => c.kind === 'f' && OWNED_FOREIGN_KEY_NAME_PATTERN.test(c.name))) {
            const fk: PostgresForeignKey | undefined = wanted.get(stored.name);
            if (fk != undefined && this.isSameForeignKey(fk, stored)) {
                continue;
            }
            await run(`ALTER TABLE ${this.escape(stored.table)} DROP CONSTRAINT ${this.escape(stored.name)}`);
            changed = true;
        }
        const stored: Set<string> = new Set((await this.readConstraints(run, names)).map(c => c.name));
        for (const fk of [...wanted.values()].filter(f => !stored.has(f.name))) {
            const owner: string = this.findTableOf(fk);
            // checked apart from adding it, which takes the lock that holds back writes only for as long
            // as adding takes rather than for as long as reading every row does
            await this.inShortLock(run, `${this.foreignKeySql(owner, fk)} NOT VALID`);
            await run(`ALTER TABLE ${this.escape(owner)} VALIDATE CONSTRAINT ${this.escape(fk.name)}`);
            changed = true;
        }

        for (const table of this.schema.tables) {
            const name: string = this.escape(table.name);
            const uniques: StoredConstraintRow[] = constraints.filter(
                c => c.table === table.name && c.kind === 'u' && c.name.startsWith('REL_')
            );
            for (const unique of uniques.filter(u => !table.uniques.some(w => w.name === u.name))) {
                await run(`ALTER TABLE ${name} DROP CONSTRAINT ${this.escape(unique.name)}`);
                changed = true;
            }
            for (const unique of table.uniques.filter(u => !uniques.some(s => s.name === u.name))) {
                await this.inShortLock(run, `ALTER TABLE ${name} ADD ${this.uniqueSql(unique)}`);
                changed = true;
            }
        }
        return changed;
    }

    /**
     * Resolves what creates the indexes, uniques and checks an entity declares on a table synchronizing
     * creates, marked the way reconciling the keys marks them, so that it finds nothing left to do.
     * @param tableName - The table.
     * @returns The statements, none for a table no entity is stored in.
     */
    private resolveDeclaredOnCreatedTable(tableName: string): string[] {
        const entity: Newable<BaseEntity> | undefined = this.entities.find(e => this.schema.getTable(e).name === tableName);
        if (entity == undefined) {
            return [];
        }
        const table: string = this.escape(tableName);
        // built at once rather than concurrently, and checked as they are added: the table holds no rows
        // and nobody reads or writes it before this boot is done, so there is nothing to wait beside
        const keys: string[] = this.resolveDeclaredKeys(entity).flatMap(key => [
            key.buildOnEmptyTable,
            ...key.constrain == undefined ? [] : [key.constrain],
            `COMMENT ON INDEX ${this.escape(PostgresSchemaManager.toStoredIdentifier(key.name))} IS ${literalToSql(DECLARED_KEY_COMMENT)}`
        ]);
        const checks: string[] = [...this.resolveDeclaredChecks(entity, tableName)]
            .map(([name, predicate]) => `ALTER TABLE ${table} ADD CONSTRAINT ${this.escape(name)} CHECK ((${predicate}) IS TRUE)`);
        return [...keys, ...checks];
    }

    /**
     * Resolves what brings the columns of a table in line with what its entity declares.
     *
     * A column whose type changed is converted where postgres can, and replaced where it cannot - which
     * is what synchronizing has always done with one.
     * @param table - The table as it is wanted.
     * @param stored - Its columns, as postgres lists them.
     * @returns The steps.
     */
    private resolveColumnSteps(table: PostgresTable, stored: Record<string, unknown>[]): SynchronizeStep[] {
        const name: string = this.escape(table.name);
        const steps: SynchronizeStep[] = [];
        for (const column of table.columns) {
            const current: Record<string, unknown> | undefined = stored.find(c => c['name'] === column.name);
            if (current == undefined) {
                steps.push({ sql: `ALTER TABLE ${name} ADD COLUMN ${this.columnSql(column)}` });
                continue;
            }
            steps.push(...this.resolveChangedColumnSteps(name, column, current));
        }
        for (const current of stored.filter(c => !table.columns.some(column => column.name === c['name']))) {
            steps.push({ sql: `ALTER TABLE ${name} DROP COLUMN ${this.escape(String(current['name']))}` });
        }
        return steps;
    }

    /**
     * Resolves what brings one stored column in line with the column its entity declares.
     * @param name - The table, quoted.
     * @param column - The column as it is wanted.
     * @param current - The column, as postgres lists it.
     * @returns The steps, none when the column matches.
     */
    private resolveChangedColumnSteps(name: string, column: PostgresColumn, current: Record<string, unknown>): SynchronizeStep[] {
        const steps: SynchronizeStep[] = [];
        const quoted: string = this.escape(column.name);
        const fullType: string = PostgresSchema.resolveFullType(column);
        if (current['type'] !== fullType || (current['collation'] ?? undefined) !== column.collation) {
            const collate: string = column.collation == undefined ? '' : ` COLLATE ${this.escape(column.collation)}`;
            steps.push({
                sql: `ALTER TABLE ${name} ALTER COLUMN ${quoted} TYPE ${fullType}${collate} USING ${quoted}::${fullType}`,
                otherwise: [`ALTER TABLE ${name} DROP COLUMN ${quoted}`, `ALTER TABLE ${name} ADD COLUMN ${this.columnSql(column)}`]
            });
        }
        if (current['nullable'] !== column.nullable) {
            steps.push({ sql: `ALTER TABLE ${name} ALTER COLUMN ${quoted} ${column.nullable ? 'DROP' : 'SET'} NOT NULL` });
        }
        if (column.generated == undefined && this.normalizeDefault(current['default']) !== column.default) {
            const defaultSql: string = column.default == undefined ? 'DROP DEFAULT' : `SET DEFAULT ${column.default}`;
            steps.push({ sql: `ALTER TABLE ${name} ALTER COLUMN ${quoted} ${defaultSql}` });
        }
        return steps;
    }

    // ── migrations ──────────────────────────────────────────────

    /**
     * Creates the table of an entity, and the join tables of the many to many relations it owns, with
     * the foreign keys they complete. The keys it declares are kept apart, as for every other entity.
     * @param run - Runs a statement in the migration's transaction.
     * @param entity - The entity.
     * @param properties - What the migration says the table holds, or that it holds what the entity declares.
     * @throws When the properties are to be resolved from an entity the data source does not declare.
     */
    async createEntity(
        run: PostgresRun,
        entity: Newable<BaseEntity>,
        properties: Record<string, MigrationPropertyMetadata> | 'resolveFromEntity'
    ): Promise<void> {
        const tableName: string = MigratedEntityUtilities.resolveTableName(entity);
        if (properties !== 'resolveFromEntity') {
            const migrated: Newable<BaseEntity> = MigratedEntityUtilities.defineEntity(tableName, properties);
            await this.createTable(run, new PostgresSchema([migrated], this.settings).getTable(migrated));
            this.createdByMigrations.add(tableName);
            return;
        }
        if (!this.entities.includes(entity)) {
            throw new InternalError(
                `Cannot create "${tableName}" from what its entity declares, because no entity of the data source is stored there.`
            );
        }
        const table: PostgresTable = this.schema.getTable(entity);
        this.createdByMigrations.add(table.name);
        // with the join table of each many to many relation it owns, which an entity does not declare
        const tables: PostgresTable[] = [
            table,
            ...this.schema.tables.filter(t => t.entityClass == undefined && t.foreignKeys[0]?.referencedTable === table.name)
        ];
        for (const created of tables) {
            await this.createTable(run, created);
        }
        await this.createForeignKeysOf(run, tables.map(t => t.name));
    }

    /**
     * Drops the table of an entity, the join tables of its many to many relations, and the foreign keys
     * of other tables referring to it.
     * @param run - Runs a statement in the migration's transaction.
     * @param tableName - The table.
     * @throws When nothing is stored under the table name.
     */
    async removeEntity(run: PostgresRun, tableName: string): Promise<void> {
        if (!(await this.findExistingTables(run, [tableName])).has(tableName)) {
            throw new InternalError(`Cannot remove ${tableName}, because nothing is stored under that name.`);
        }
        // found in the database rather than in the entities, which declare the join tables of an entity
        // only for as long as it is one of them. A join table is a table whose primary key is made of
        // its foreign keys
        const joinTables: Record<string, unknown>[] = await run(
            'SELECT DISTINCT c.relname AS "name" FROM pg_constraint fk'
            + ' JOIN pg_class c ON c.oid = fk.conrelid'
            + ' JOIN pg_namespace n ON n.oid = c.relnamespace'
            + ' JOIN pg_constraint pk ON pk.conrelid = fk.conrelid AND pk.contype = \'p\''
            + ' WHERE n.nspname = current_schema() AND fk.contype = \'f\' AND fk.confrelid = to_regclass($1)'
            + ' AND pk.conkey <@ (SELECT array_agg(k) FROM pg_constraint f, unnest(f.conkey) k'
            + ' WHERE f.conrelid = fk.conrelid AND f.contype = \'f\')',
            [this.escape(tableName)]
        );
        for (const joinTable of joinTables.map(row => String(row['name'])).filter(name => name !== tableName)) {
            await run(`DROP TABLE ${this.escape(joinTable)}`);
        }
        // cascading to the foreign keys of other tables, whose columns stay: they are properties of
        // entities that remain
        await run(`DROP TABLE ${this.escape(tableName)} CASCADE`);
        this.createdByMigrations.delete(tableName);
    }

    /**
     * Drops the join table of a many to many relation, from whichever of its two sides owns it. A
     * relation without one keeps nothing apart from its columns, and nothing is dropped for it.
     * @param run - Runs a statement in the migration's transaction.
     * @param tableName - The table of one side.
     * @param key - The relation's property on that side.
     * @param targetTableName - The table of the other side.
     * @param inverseSide - The relation's property on the other side.
     */
    async removeJoinTable(run: PostgresRun, tableName: string, key: string, targetTableName: string, inverseSide: string): Promise<void> {
        const candidates: string[] = [
            PostgresSchema.resolveJoinTableName(tableName, key, targetTableName),
            PostgresSchema.resolveJoinTableName(targetTableName, inverseSide, tableName)
        ];
        for (const joinTable of await this.findExistingTables(run, candidates)) {
            await run(`DROP TABLE ${this.escape(joinTable)}`);
        }
    }

    /**
     * Adds the column a property a migration describes is stored in, accepting no value whatever the
     * property says: the rows already stored have none yet, until the migration fills them.
     * @param run - Runs a statement in the migration's transaction.
     * @param tableName - The table.
     * @param name - The property.
     * @param property - What the migration says about it.
     */
    async addProperty(run: PostgresRun, tableName: string, name: string, property: MigrationPropertyMetadata): Promise<void> {
        const column: PostgresColumn = this.buildMigratedColumn(tableName, name, property);
        await run(`ALTER TABLE ${this.escape(tableName)} ADD COLUMN ${this.columnSql({ ...column, nullable: true })}`);
    }

    /**
     * Changes what a property is stored as, its name included, converting the values stored.
     * @param run - Runs a statement in the migration's transaction.
     * @param tableName - The table.
     * @param conversion - The change.
     * @param currentProperty - The property as the migration says it is stored now.
     * @param property - The property as it is to be stored.
     * @throws When the column is not stored, or not stored as the migration says, or a value cannot be converted.
     */
    async changeProperty(
        run: PostgresRun,
        tableName: string,
        conversion: ResolvedPropertyConversion,
        currentProperty: MigrationPropertyMetadata,
        property: MigrationPropertyMetadata
    ): Promise<void> {
        // the column as the database holds it rather than as the class declares it: a rename is the one
        // change where the class has no column under the stored name any more
        const stored: Record<string, unknown> | undefined = (await run(STORED_COLUMNS_SQL, [[tableName]]))
            .find(c => c['name'] === conversion.currentName);
        if (stored == undefined) {
            throw new InternalError(
                `Cannot change ${conversion.entity}.${conversion.currentName}, because nothing is stored under that name.`
            );
        }
        const current: PostgresColumn = this.toStoredColumn(stored);
        // the column the migration describes rather than the one the entity declares now, since the
        // entity may have changed again by the time an old migration runs
        const described: PostgresColumn = this.buildMigratedColumn(tableName, conversion.currentName, currentProperty);
        if (!this.isSameColumnType(current, described)) {
            throw new InternalError(
                `Cannot change ${conversion.entity}.${conversion.currentName},`
                + ` because it is stored as ${PostgresSchema.resolveFullType(current)},`
                + ` and the current property describes ${PostgresSchema.resolveFullType(described)}.`
            );
        }
        const changed: PostgresColumn = this.buildMigratedColumn(tableName, conversion.changedName, property);
        const table: string = this.escape(tableName);
        // every value checked before anything changes, so that a migration that cannot convert one fails
        // naming all of them rather than with whatever the database makes of the first
        const refusals: string | undefined = PostgresValueConversionUtilities.resolveRefusalsQuery(
            table,
            this.toColumnSql(current),
            this.toColumnSql(changed),
            conversion
        );
        const refused: RefusedValue[] = refusals == undefined ? [] : await this.resolveRefusedValues(run, refusals);
        ValueConversionUtilities.validateNothingRefused(conversion, refused);

        const quoted: string = this.escape(current.name);
        // a conversion collates as the changed column does, which for a type that is not text is not at all
        const collate: string = changed.collation == undefined ? '' : ` COLLATE ${this.escape(changed.collation)}`;
        if (!this.isSameColumnType(current, changed) || conversion.values.length) {
            if (!this.isSameColumnType(current, changed)) {
                // changing the type rebuilds every index on the column, and a trigram index takes text
                // alone. Reconciling the keys after the migrations builds it again where one is declared
                const trigramIndex: string = PostgresSchemaManager.toStoredIdentifier(trigramIndexName(tableName, current.name));
                await run(`DROP INDEX IF EXISTS ${this.escape(trigramIndex)}`);
            }
            // in place, because dropping and adding the column empties it, and a required one cannot come
            // back at all on a table that has rows. The default first: it is of the old type
            await run('SET LOCAL extra_float_digits = 1');
            const converted: string = PostgresValueConversionUtilities.resolveConvertedSql(
                this.toColumnSql(current),
                this.toColumnSql(changed),
                conversion
            );
            await run(
                `ALTER TABLE ${table} ALTER COLUMN ${quoted} DROP DEFAULT,`
                + ` ALTER COLUMN ${quoted} TYPE ${PostgresSchema.resolveFullType(changed)}${collate}`
                + ` USING ${converted}`
            );
            current.default = undefined;
        }
        else if (current.collation !== changed.collation) {
            await run(`ALTER TABLE ${table} ALTER COLUMN ${quoted} TYPE ${PostgresSchema.resolveFullType(changed)}${collate}`);
        }
        if (current.nullable !== changed.nullable) {
            await run(`ALTER TABLE ${table} ALTER COLUMN ${quoted} ${changed.nullable ? 'DROP' : 'SET'} NOT NULL`);
        }
        if (this.normalizeDefault(current.default) !== changed.default) {
            const defaultSql: string = changed.default == undefined ? 'DROP DEFAULT' : `SET DEFAULT ${changed.default}`;
            await run(`ALTER TABLE ${table} ALTER COLUMN ${quoted} ${defaultSql}`);
        }
        if (changed.name !== current.name) {
            await this.renameColumn(run, tableName, current.name, changed.name);
        }
    }

    /**
     * Runs the query for the values a conversion cannot convert, and reads what it answers.
     * @param run - Runs a statement in the migration's transaction.
     * @param refusals - The query.
     * @returns Each value refused, with why.
     * @throws When the query answers something that is no refusal.
     */
    private async resolveRefusedValues(run: PostgresRun, refusals: string): Promise<RefusedValue[]> {
        await run('SET LOCAL extra_float_digits = 1');
        return (await run(refusals)).map(row => {
            const refusal: ConversionRefusal | undefined = Object.values(ConversionRefusal).find(r => r === row['refusal']);
            if (refusal == undefined) {
                throw new InternalError(`The query for refused values answered "${String(row['refusal'])}", which is no refusal.`);
            }
            return { value: row['value'], refusal };
        });
    }

    /**
     * Drops the column a property is stored in.
     * @param run - Runs a statement in the migration's transaction.
     * @param tableName - The table.
     * @param name - The property.
     */
    async removeProperty(run: PostgresRun, tableName: string, name: string): Promise<void> {
        await run(`ALTER TABLE ${this.escape(tableName)} DROP COLUMN ${this.escape(name)}`);
    }

    /**
     * Moves what an entity stored under another table name to the one it declares, its join tables and
     * the keys named after them included.
     * @param run - Runs a statement in the migration's transaction.
     * @param moved - The entity, and the table name it is stored under afterwards.
     * @param currentTableName - The table name it is stored under now.
     * @throws When something is stored under the new name already, or nothing under the current one.
     */
    async renameEntity(run: PostgresRun, moved: MovedEntity, currentTableName: string): Promise<void> {
        const { entityClass: entity, tableName } = moved;
        const existing: Set<string> = await this.findExistingTables(run, [tableName, currentTableName]);
        if (existing.has(tableName)) {
            throw new InternalError(
                `Cannot rename ${currentTableName} to ${tableName}, because something is stored under ${tableName} already.`
            );
        }
        if (!existing.has(currentTableName)) {
            throw new InternalError(
                `Cannot rename ${currentTableName} to ${tableName}, because nothing is stored under ${currentTableName}.`
            );
        }
        const joinTables: RenamedJoinTable[] = this.resolveRenamedJoinTables(entity, currentTableName, tableName);
        await this.renameTable(run, currentTableName, tableName, []);
        for (const joinTable of joinTables) {
            await this.renameTable(
                run,
                joinTable.current.name,
                joinTable.renamed.name,
                joinTable.current.columns.map((c, i): [string, string] => [c.name, joinTable.renamed.columns[i]?.name ?? c.name])
            );
        }
        await this.renameDeclaredKeys(run, currentTableName, tableName);
    }

    /**
     * Moves the rows an entity stored under another table name into the table it declares, with the
     * relations they hold, and drops what they were stored in.
     * @param run - Runs a statement in the migration's transaction.
     * @param moved - The entity, and the table name its rows are moved to.
     * @param currentTableName - The table name the rows are stored under now.
     * @throws When nothing is stored under the current name.
     */
    async mergeEntity(run: PostgresRun, moved: MovedEntity, currentTableName: string): Promise<void> {
        const { entityClass: entity, tableName } = moved;
        const existing: Set<string> = await this.findExistingTables(run, [tableName, currentTableName]);
        if (!existing.has(currentTableName)) {
            throw new InternalError(
                `Cannot merge ${currentTableName} into ${tableName}, because nothing is stored under ${currentTableName}.`
            );
        }
        // into nothing, which is what renaming is
        if (!existing.has(tableName)) {
            await this.renameEntity(run, moved, currentTableName);
            return;
        }
        const stored: Record<string, unknown>[] = await run(STORED_COLUMNS_SQL, [[currentTableName, tableName]]);
        const currentColumns: Set<unknown> = new Set(stored.filter(c => c['table'] === currentTableName).map(c => c['name']));
        const columns: string[] = stored.filter(c => c['table'] === tableName && currentColumns.has(c['name'])).map(c => String(c['name']));
        // a join table that is not there holds no relation, because the entities merged from had none
        const joinTables: RenamedJoinTable[] = [];
        const renamedJoinTables: RenamedJoinTable[] = this.resolveRenamedJoinTables(entity, currentTableName, tableName);
        const storedJoinTables: Set<string> = await this.findExistingTables(run, renamedJoinTables.map(j => j.current.name));
        for (const joinTable of renamedJoinTables) {
            if (storedJoinTables.has(joinTable.current.name)) {
                joinTables.push(joinTable);
            }
        }
        await this.mergeRows(run, entity, currentTableName, tableName, columns, joinTables);
        await this.pointForeignKeysAt(run, currentTableName, tableName);
        for (const joinTable of joinTables) {
            await run(`DROP TABLE ${this.escape(joinTable.current.name)}`);
        }
        await run(`DROP TABLE ${this.escape(currentTableName)}`);
    }

    /**
     * Copies the rows a migration merges, and the relations they hold, leaving out every row breaking
     * the primary key or a unique of the table it is merged into, with its relations.
     * @param run - Runs a statement.
     * @param entity - The entity merged into.
     * @param currentTableName - The table the rows are merged from.
     * @param tableName - The table they are merged into.
     * @param columns - The columns both tables have.
     * @param joinTables - The join tables of the rows merged from.
     */
    private async mergeRows(
        run: PostgresRun,
        entity: Newable<BaseEntity>,
        currentTableName: string,
        tableName: string,
        columns: string[],
        joinTables: RenamedJoinTable[]
    ): Promise<void> {
        const current: string = this.escape(currentTableName);
        const table: string = this.escape(tableName);
        const list: string = columns.map(c => this.escape(c)).join(', ');
        const primary: string = this.escape('id');
        const sameAsStored: (unique: string[]) => string = unique => unique
            .map(c => `stored.${this.escape(c)} = ${current}.${this.escape(c)}`)
            .join(' AND ');
        const uniques: MergedUnique[] = [
            { columns: ['id'], where: undefined },
            ...keyGroupsOf(entity).uniques.map(u => ({
                columns: u.properties,
                where: u.where == undefined || coversEveryRow(u.where) ? undefined : keyWhereToSql(entity, u.where)
            }))
        ];
        // a condition unqualified both times: inside the subquery its columns are the stored row's,
        // outside it the merged one's
        const conflicts: string[] = uniques.map(u => u.where == undefined
            ? `EXISTS (SELECT 1 FROM ${table} AS stored WHERE ${sameAsStored(u.columns)})`
            : `((${u.where}) AND EXISTS (SELECT 1 FROM ${table} AS stored WHERE ${sameAsStored(u.columns)} AND (${u.where})))`);
        const moved: Record<string, unknown>[] = await run(
            `INSERT INTO ${table} (${list}) SELECT ${list} FROM ${current}`
            + ` WHERE NOT (${conflicts.join(' OR ')}) RETURNING ${primary}::text AS "id"`
        );
        // a numeric id moved with its row is one the sequence of the table has not handed out yet, and
        // would hand out again. Looked up first: postgres plans the max even when no sequence is found,
        // and there is no max of a uuid
        const [sequence] = await run('SELECT pg_get_serial_sequence($1, $2) AS "name"', [table, 'id']);
        if (sequence?.['name'] != undefined) {
            await run(`SELECT setval($1, (SELECT max(${primary}) FROM ${table}))`, [sequence['name']]);
        }
        const ids: string[] = moved.map(row => String(row['id']));
        for (const joinTable of joinTables) {
            // only the relations of rows that were moved, which is every row the relation names
            const ofMoved: string = joinTable.entityColumns.map(c => `${this.escape(c)}::text = ANY($1)`).join(' AND ');
            const into: string = joinTable.renamed.columns.map(c => this.escape(c.name)).join(', ');
            const from: string = joinTable.current.columns.map(c => this.escape(c.name)).join(', ');
            await run(
                `INSERT INTO ${this.escape(joinTable.renamed.name)} (${into})`
                + ` SELECT ${from} FROM ${this.escape(joinTable.current.name)} WHERE ${ofMoved}`,
                [ids]
            );
        }
    }

    /**
     * Points the foreign keys of every table that refer to one table at another, under the same names.
     * @param run - Runs a statement.
     * @param currentTableName - The table they refer to now.
     * @param tableName - The table they refer to afterwards.
     */
    private async pointForeignKeysAt(run: PostgresRun, currentTableName: string, tableName: string): Promise<void> {
        const constraints: StoredConstraintRow[] = await this.readConstraints(run, this.schema.tables.map(t => t.name));
        for (const fk of constraints.filter(c => c.kind === 'f' && c.referencedTable === currentTableName)) {
            await run(`ALTER TABLE ${this.escape(fk.table)} DROP CONSTRAINT ${this.escape(fk.name)}`);
            await run(this.foreignKeySql(fk.table, {
                name: fk.name,
                columns: fk.columns,
                referencedTable: tableName,
                referencedColumns: fk.referencedColumns,
                onDelete: fk.onDelete === 'c' ? 'CASCADE' : 'NO ACTION',
                onUpdate: fk.onUpdate === 'c' ? 'CASCADE' : 'NO ACTION'
            }));
        }
    }

    /**
     * Renames a table, its columns, and the keys named after either the way the tables were named by
     * typeorm: the primary key, the foreign keys, the uniques of its relations, the indexes of a join
     * table, and the sequence of a numeric id.
     * @param run - Runs a statement.
     * @param currentName - The table's name now.
     * @param name - Its name afterwards.
     * @param columns - Its columns that are renamed, as their names now and afterwards.
     */
    private async renameTable(run: PostgresRun, currentName: string, name: string, columns: [string, string][]): Promise<void> {
        const constraints: StoredConstraintRow[] = await this.readConstraints(run, [currentName]);
        const indexes: string[] = (await run(
            'SELECT indexname AS "name" FROM pg_indexes'
            + ' WHERE schemaname = current_schema() AND tablename = $1 AND indexname LIKE \'IDX\\_%\'',
            [currentName]
        )).map(row => String(row['name']));
        await run(`ALTER TABLE ${this.escape(currentName)} RENAME TO ${this.escape(name)}`);
        const renamed: Map<string, string> = new Map(columns.filter(([a, b]) => a !== b));
        for (const [current, changed] of renamed) {
            await run(`ALTER TABLE ${this.escape(name)} RENAME COLUMN ${this.escape(current)} TO ${this.escape(changed)}`);
        }
        const after: (column: string) => string = column => renamed.get(column) ?? column;
        const prefixes: Record<string, [string, number]> = { p: ['PK_', 27], f: ['FK_', 27], u: ['REL_', 26] };
        for (const constraint of constraints) {
            const [prefix, length] = prefixes[constraint.kind] ?? ['', 0];
            const typeOrmNamed: boolean = constraint.name
                === PostgresSchema.resolveKeyName(prefix, currentName, constraint.columns, length);
            if (typeOrmNamed) {
                const changed: string = PostgresSchema.resolveKeyName(prefix, name, constraint.columns.map(after), length);
                await run(
                    `ALTER TABLE ${this.escape(name)} RENAME CONSTRAINT ${this.escape(constraint.name)} TO ${this.escape(changed)}`
                );
            }
        }
        for (const index of indexes) {
            const column: string | undefined = columns
                .map(([c]) => c)
                .find(c => index === PostgresSchema.resolveKeyName('IDX_', currentName, [c], 26));
            if (column != undefined) {
                const changed: string = PostgresSchema.resolveKeyName('IDX_', name, [after(column)], 26);
                await run(`ALTER INDEX ${this.escape(index)} RENAME TO ${this.escape(changed)}`);
            }
        }
        // asked of the catalog rather than of pg_get_serial_sequence, which fails on a table without an
        // id - a join table - and answers schema qualified, which a configured schema does not match
        const owned: Record<string, unknown>[] = await run(
            'SELECT 1 FROM pg_depend d JOIN pg_class s ON s.oid = d.objid'
            + ' WHERE d.classid = \'pg_class\'::regclass AND d.refobjid = to_regclass($1) AND d.deptype IN (\'a\', \'i\')'
            + ' AND s.relkind = \'S\' AND s.relname = $2',
            [this.escape(name), `${currentName}_id_seq`]
        );
        if (owned.length) {
            const currentSequence: string = `${currentName}_id_seq`;
            const sequence: string = `${name}_id_seq`;
            await run(`ALTER SEQUENCE ${this.escape(currentSequence)} RENAME TO ${this.escape(sequence)}`);
        }
    }

    private async renameColumn(run: PostgresRun, tableName: string, current: string, changed: string): Promise<void> {
        await run(`ALTER TABLE ${this.escape(tableName)} RENAME COLUMN ${this.escape(current)} TO ${this.escape(changed)}`);
    }

    /**
     * Renames the indexes and uniques an entity declares along with the table they are on, which the
     * data source names after the table.
     * @param run - Runs a statement.
     * @param currentTableName - The name the table had.
     * @param tableName - The name it has now.
     */
    private async renameDeclaredKeys(run: PostgresRun, currentTableName: string, tableName: string): Promise<void> {
        const prefixes: [string, string][] = [
            [uniqueConstraintName(currentTableName, []), uniqueConstraintName(tableName, [])],
            [indexName(currentTableName, []), indexName(tableName, [])],
            [trigramIndexName(currentTableName, ''), trigramIndexName(tableName, '')]
        ];
        const stored: StoredKeyRow[] = await this.readStoredKeys(run, [tableName]);
        for (const key of stored.filter(k => k.marked)) {
            const match: [string, string] | undefined = prefixes.find(([prefix]) => key.name.startsWith(prefix));
            if (match == undefined) {
                continue;
            }
            const [current, changed]: [string, string] = match;
            // renaming the index renames the constraint enforced through it, too
            const renamed: string = PostgresSchemaManager.toStoredIdentifier(`${changed}${key.name.slice(current.length)}`);
            await run(`ALTER INDEX ${this.escape(key.name)} RENAME TO ${this.escape(renamed)}`);
        }
    }

    /**
     * Resolves the join tables an entity takes part in, as they are named while it is stored under
     * another table name, and as they are named once it is not.
     * @param entity - The entity being renamed.
     * @param currentTableName - The table name it is stored under now.
     * @param tableName - The table name it is stored under afterwards.
     * @returns Every join table at either end of one of its many to many relations.
     */
    private resolveRenamedJoinTables(entity: Newable<BaseEntity>, currentTableName: string, tableName: string): RenamedJoinTable[] {
        // an entity of no data source is in no relation here
        if (!this.entities.includes(entity)) {
            return [];
        }
        // both named here rather than the one afterwards taken from the schema: what reverts a rename
        // moves the entity back to a table name it no longer declares
        const current: PostgresSchema = new PostgresSchema(this.entities, this.settings, new Map([[entity, currentTableName]]));
        const renamedSchema: PostgresSchema = new PostgresSchema(this.entities, this.settings, new Map([[entity, tableName]]));
        const res: RenamedJoinTable[] = [];
        const joinTables: PostgresTable[] = current.tables.filter(t => t.entityClass == undefined);
        for (const [i, joinTable] of joinTables.entries()) {
            const renamed: PostgresTable | undefined = renamedSchema.tables.filter(t => t.entityClass == undefined)[i];
            const entityColumns: string[] = joinTable.foreignKeys
                .filter(fk => fk.referencedTable === currentTableName)
                .flatMap(fk => fk.columns);
            if (renamed != undefined && entityColumns.length) {
                res.push({ current: joinTable, renamed, entityColumns });
            }
        }
        // the table name it is renamed to is the one the schema holds, so a join table naming neither is
        // one this rename has nothing to do with
        return res.filter(j => j.renamed.foreignKeys.some(fk => fk.referencedTable === tableName));
    }

    // ── tables ──────────────────────────────────────────────────

    /**
     * Creates a table with its columns, its primary key, the uniques of its relations and the indexes of
     * a join table. Its foreign keys are created once the tables they refer to are there.
     * @param run - Runs a statement.
     * @param table - The table.
     * @param ifNotExists - Whether a table stored under its name already is left as it is.
     */
    async createTable(run: PostgresRun, table: PostgresTable, ifNotExists: boolean = false): Promise<void> {
        // the table and its indexes in one round trip
        await run(this.resolveCreateTable(table, ifNotExists).join(';\n'));
    }

    /**
     * Creates the table of an entity when none is stored under its name, with everything the entity
     * declares on it, in one round trip. Run while nothing else can create it.
     * @param run - Runs a statement.
     * @param entity - The entity.
     */
    async createEntityTableIfNotExists(run: PostgresRun, entity: Newable<BaseEntity>): Promise<void> {
        const table: PostgresTable = this.schema.getTable(entity);
        const [stored] = await run(
            'SELECT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = current_schema() AND tablename = $1) AS "stored"',
            [table.name]
        );
        if (stored?.['stored'] === true) {
            return;
        }
        // built at once with it rather than reconciled later, which builds concurrently and so waits for
        // every transaction of the database to end - the instances waiting for this boot among them
        await run([...this.resolveCreateTable(table, false), ...this.resolveDeclaredOnCreatedTable(table.name)].join(';\n'));
    }

    private resolveCreateTable(table: PostgresTable, ifNotExists: boolean): string[] {
        const primaryColumns: string = table.primaryKey.columns.map(c => this.escape(c)).join(', ');
        const definitions: string[] = [
            ...table.columns.map(c => this.columnSql(c)),
            `CONSTRAINT ${this.escape(table.primaryKey.name)} PRIMARY KEY (${primaryColumns})`,
            ...table.uniques.map(u => this.uniqueSql(u))
        ];
        return [
            `CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${this.escape(table.name)} (${definitions.join(', ')})`,
            ...table.indexes.map(index => this.indexSql(table.name, index, ifNotExists))
        ];
    }

    /**
     * Creates the foreign keys that tables just created complete: each one by whichever of its two
     * tables comes second, which lets a migration create its entities in any order.
     * @param run - Runs a statement.
     * @param created - The tables just created.
     */
    private async createForeignKeysOf(run: PostgresRun, created: string[]): Promise<void> {
        const candidates: PostgresForeignKey[] = this.schema.tables.flatMap(t => t.foreignKeys
            .filter(fk => created.includes(t.name) || created.includes(fk.referencedTable)));
        if (!candidates.length) {
            return;
        }
        const tables: string[] = [...new Set(candidates.flatMap(fk => [this.findTableOf(fk), fk.referencedTable]))];
        const existing: Set<string> = await this.findExistingTables(run, tables);
        const stored: Set<string> = new Set((await this.readConstraints(run, tables)).filter(c => c.kind === 'f').map(c => c.name));
        for (const fk of candidates) {
            const owner: string = this.findTableOf(fk);
            if (!stored.has(fk.name) && existing.has(owner) && existing.has(fk.referencedTable)) {
                await run(this.foreignKeySql(owner, fk));
            }
        }
    }

    private columnSql(column: PostgresColumn): string {
        const type: string = column.generated === 'increment'
            ? column.type === 'integer' ? 'SERIAL' : 'BIGSERIAL'
            : PostgresSchema.resolveFullType(column);
        const parts: string[] = [this.escape(column.name), type];
        if (column.collation != undefined) {
            parts.push(`COLLATE ${this.escape(column.collation)}`);
        }
        if (!column.nullable) {
            parts.push('NOT NULL');
        }
        // gen_random_uuid() is part of postgres itself, where uuid_generate_v4() needs an extension
        // and a role allowed to create it
        const defaultSql: string | undefined = column.generated === 'uuid' ? 'gen_random_uuid()' : column.default;
        if (defaultSql != undefined) {
            parts.push(`DEFAULT ${defaultSql}`);
        }
        return parts.join(' ');
    }

    private uniqueSql(unique: PostgresKey): string {
        return `CONSTRAINT ${this.escape(unique.name)} UNIQUE (${unique.columns.map(c => this.escape(c)).join(', ')})`;
    }

    private indexSql(tableName: string, index: PostgresKey, ifNotExists: boolean = false): string {
        return `CREATE INDEX ${ifNotExists ? 'IF NOT EXISTS ' : ''}${this.escape(index.name)} ON ${this.escape(tableName)}`
            + ` (${index.columns.map(c => this.escape(c)).join(', ')})`;
    }

    private foreignKeySql(tableName: string, fk: PostgresForeignKey): string {
        return `ALTER TABLE ${this.escape(tableName)} ADD CONSTRAINT ${this.escape(fk.name)}`
            + ` FOREIGN KEY (${fk.columns.map(c => this.escape(c)).join(', ')})`
            + ` REFERENCES ${this.escape(fk.referencedTable)}(${fk.referencedColumns.map(c => this.escape(c)).join(', ')})`
            + ` ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`;
    }

    private isSameForeignKey(fk: PostgresForeignKey, stored: StoredConstraintRow): boolean {
        return stored.referencedTable === fk.referencedTable
            && stored.columns.join() === fk.columns.join()
            && stored.referencedColumns.join() === fk.referencedColumns.join()
            && (stored.onDelete === 'c') === (fk.onDelete === 'CASCADE')
            && (stored.onUpdate === 'c') === (fk.onUpdate === 'CASCADE');
    }

    private findTableOf(fk: PostgresForeignKey): string {
        const table: PostgresTable | undefined = this.schema.tables.find(t => t.foreignKeys.includes(fk));
        if (table == undefined) {
            throw new InternalError(`The foreign key "${fk.name}" belongs to no table.`);
        }
        return table.name;
    }

    /**
     * Refuses a table the entities need that the database does not hold, naming the entity it belongs to.
     *
     * Checked once the migrations of a data source they manage have run: a table none of them created
     * was otherwise found by whatever read it first, an index built on it with "relation does not
     * exist", or the first request using it. A join table is not one of them: reconciling the
     * relations creates it, as it does the foreign keys.
     * @param run - Runs a statement.
     * @throws When the table of an entity does not exist.
     */
    async validateTablesExist(run: PostgresRun): Promise<void> {
        const tableNames: Map<Newable<BaseEntity>, string> = new Map(this.entities.map(e => [e, this.schema.getTable(e).name]));
        const existing: Set<string> = await this.findExistingTables(run, [...tableNames.values()]);
        const named: string[] = [...tableNames]
            .filter(([, tableName]) => !existing.has(tableName))
            .map(([entity, tableName]) => `"${entity.name}" (table "${tableName}")`);
        if (!named.length) {
            return;
        }
        throw new InternalError([
            `The database holds no table for ${named.join(', ')}.`,
            'Migrations manage this schema, and none of them created it. Add one that calls createEntity.'
        ]);
    }

    private async findExistingTables(run: PostgresRun, names: string[]): Promise<Set<string>> {
        const rows: Record<string, unknown>[] = await run(
            'SELECT tablename AS "name" FROM pg_tables WHERE schemaname = current_schema() AND tablename = ANY($1)',
            [names]
        );
        return new Set(rows.map(row => String(row['name'])));
    }

    private async readConstraints(run: PostgresRun, tables: string[]): Promise<StoredConstraintRow[]> {
        return (await run(STORED_CONSTRAINTS_SQL, [tables])).map(row => ({
            table: String(row['table']),
            name: String(row['name']),
            kind: String(row['kind']),
            columns: Array.isArray(row['columns']) ? row['columns'].map(String) : [],
            referencedTable: typeof row['referencedTable'] === 'string' ? row['referencedTable'] : undefined,
            referencedColumns: Array.isArray(row['referencedColumns']) ? row['referencedColumns'].map(String) : [],
            onDelete: String(row['onDelete']),
            onUpdate: String(row['onUpdate'])
        }));
    }

    /**
     * Builds the column of a property a migration describes, as an entity declaring it would store it.
     * @param tableName - The table.
     * @param name - The property.
     * @param metadata - What the migration says about it.
     * @returns The column.
     */
    private buildMigratedColumn(tableName: string, name: string, metadata: MigrationPropertyMetadata): PostgresColumn {
        const migrated: Newable<BaseEntity> = MigratedEntityUtilities.defineEntity(tableName, { [name]: metadata });
        return new PostgresSchema([migrated], this.settings).getColumn(migrated, name);
    }

    /**
     * Reads a column as postgres lists it into the shape a column is built in.
     * @param stored - The column, as postgres lists it.
     * @returns The column.
     */
    private toStoredColumn(stored: Record<string, unknown>): PostgresColumn {
        const full: string = String(stored['type']);
        const isArray: boolean = full.endsWith('[]');
        const base: string = isArray ? full.slice(0, -2) : full;
        const length: RegExpExecArray | null = /^(character varying|character)\((\d+)\)$/.exec(base);
        return {
            name: String(stored['name']),
            property: String(stored['name']),
            type: length?.[1] ?? base,
            length: length?.[2] == undefined ? undefined : Number(length[2]),
            isArray,
            nullable: stored['nullable'] === true,
            default: typeof stored['default'] === 'string' ? stored['default'] : undefined,
            generated: undefined,
            collation: typeof stored['collation'] === 'string' ? stored['collation'] : undefined,
            toColumn: value => value,
            fromColumn: value => value
        };
    }

    private toColumnSql(column: PostgresColumn): PostgresColumnSql {
        return { name: this.escape(column.name), stored: column, type: PostgresSchema.resolveFullType(column) };
    }

    private isSameColumnType(a: PostgresColumn, b: PostgresColumn): boolean {
        return a.type === b.type && a.length === b.length && a.isArray === b.isArray;
    }

    /**
     * A default as postgres lists it, without the cast it adds, which is how a column declares it.
     * @param value - The default as listed.
     * @returns It, without its cast.
     */
    private normalizeDefault(value: unknown): string | undefined {
        // listed as text, or not at all
        if (typeof value !== 'string') {
            return undefined;
        }
        let res: string = value;
        while (TRAILING_CAST_PATTERN.test(res)) {
            res = res.replace(TRAILING_CAST_PATTERN, '');
        }
        return res;
    }

    // ── declared keys ───────────────────────────────────────────

    /**
     * Makes the indexes, uniques and checks of every entity's table match what the entities declare,
     * creating every declared one over the rows already stored and dropping every one the data source
     * created that no entity declares anymore.
     * @param run - Runs a statement on a session of its own, with no transaction: an index is built
     * concurrently, which writes go on beside.
     * @returns Whether anything was created or dropped.
     */
    async reconcileKeys(run: PostgresRun): Promise<boolean> {
        const tables: string[] = this.entities.map(entity => this.schema.getTable(entity).name);
        let changed: boolean = await this.buildOnTablesCreatedByMigrations(run);
        // read for every table at once, so that a boot finding everything in place costs the same
        // however many entities it declares
        const keys: StoredKeyRow[] = await this.readStoredKeys(run, tables);
        const checks: StoredCheckRow[] = await this.readStoredChecks(run, tables);
        for (const entity of this.entities) {
            const tableName: string = this.schema.getTable(entity).name;
            const keysOf: StoredKeyRow[] = keys.filter(k => k.table === tableName);
            const checksOf: StoredCheckRow[] = checks.filter(c => c.table === tableName);
            changed = await this.reconcileKeysOf(run, entity, keysOf, checksOf) || changed;
        }
        return changed;
    }

    /**
     * Builds what the entities declare on the tables this boot's migrations created, all in one round
     * trip: at once rather than concurrently, since no instance reads or writes a table before the boot
     * creating it is done. After the migrations rather than as each table is created, so that a later
     * migration changing a column finds no index on it built for what it held before.
     * @param run - Runs a statement.
     * @returns Whether anything was built. Nothing is when a row the migrations wrote breaks one of
     * them, which leaves them to reconciling one at a time, where the failure names the row.
     */
    private async buildOnTablesCreatedByMigrations(run: PostgresRun): Promise<boolean> {
        const statements: string[] = [...this.createdByMigrations].flatMap(tableName => this.resolveDeclaredOnCreatedTable(tableName));
        this.createdByMigrations.clear();
        if (!statements.length) {
            return false;
        }
        try {
            // one implicit transaction, so a statement that fails leaves none of the others behind
            await run(statements.join(';\n'));
            return true;
        }
        catch {
            return false;
        }
    }

    private async reconcileKeysOf(
        run: PostgresRun,
        entity: Newable<BaseEntity>,
        stored: StoredKeyRow[],
        storedChecks: StoredCheckRow[]
    ): Promise<boolean> {
        const tableName: string = this.schema.getTable(entity).name;
        const declared: DeclaredKey[] = this.resolveDeclaredKeys(entity);
        const declaredNames: Set<string> = new Set(declared.map(k => PostgresSchemaManager.toStoredIdentifier(k.name)));
        // what this data source created, which carries its comment - or, from before it did, the name of
        // one declared now. And what 2.x left, which typeorm named. Everything else is somebody else's
        const owned: StoredKeyRow[] = stored.filter(
            k => k.marked || declaredNames.has(k.name) || ORM_DEFAULT_KEY_NAME_PATTERN.test(k.name)
        );

        // what a build that failed leaves behind: an index that serves nothing and is kept up all the same
        for (const leftover of owned.filter(k => !k.valid)) {
            await run(`DROP INDEX CONCURRENTLY IF EXISTS ${this.escape(leftover.name)}`);
            this.logger.info(`Dropped the index "${leftover.name}" of the table "${tableName}": building it had failed.`);
        }
        const kept: Map<string, StoredKeyRow> = new Map(owned.filter(k => k.valid).map(k => [k.name, k]));
        const missing: DeclaredKey[] = declared.filter(k => !kept.has(PostgresSchemaManager.toStoredIdentifier(k.name)));
        const abandoned: StoredKeyRow[] = [...kept.values()].filter(k => !declaredNames.has(k.name));

        // created before anything is dropped, so that a unique whose name changed is enforced throughout
        for (const key of missing) {
            await this.createDeclaredKey(run, entity, key);
        }
        // an index built before the constraint could take it over, by a boot that stopped in between
        const unconstrained: DeclaredKey[] = declared.filter(
            k => k.constrain != undefined && kept.get(PostgresSchemaManager.toStoredIdentifier(k.name))?.constraint === false
        );
        for (const key of unconstrained) {
            await this.inShortLock(run, key.constrain ?? '');
        }
        // marked after it is built rather than with it, which a concurrent build cannot be
        for (const key of declared.filter(k => kept.get(PostgresSchemaManager.toStoredIdentifier(k.name))?.marked !== true)) {
            const index: string = this.escape(PostgresSchemaManager.toStoredIdentifier(key.name));
            await run(`COMMENT ON INDEX ${index} IS ${literalToSql(DECLARED_KEY_COMMENT)}`);
        }
        const table: string = this.escape(tableName);
        for (const key of abandoned) {
            await (key.constraint
                ? this.inShortLock(run, `ALTER TABLE ${table} DROP CONSTRAINT ${this.escape(key.name)}`)
                : run(`DROP INDEX CONCURRENTLY IF EXISTS ${this.escape(key.name)}`));
            this.logger.info(`Dropped the index "${key.name}" of the table "${tableName}": no entity declares it anymore.`);
        }
        const checksChanged: boolean = await this.reconcileChecksOf(run, entity, tableName, storedChecks);
        return missing.length > 0 || abandoned.length > 0 || checksChanged;
    }

    /**
     * Makes the check constraints of one entity's table match the checks it declares: added without
     * looking at the stored rows, which takes the table only for a moment, and then validated over the
     * rows stored before, which writes go on beside.
     * @param run - Runs a statement.
     * @param entity - The entity.
     * @param tableName - Its table.
     * @param stored - The check constraints of its table.
     * @returns Whether a check was added or dropped.
     * @throws When a stored row breaks a check, naming the row. The check is not kept.
     */
    private async reconcileChecksOf(
        run: PostgresRun,
        entity: Newable<BaseEntity>,
        tableName: string,
        stored: StoredCheckRow[]
    ): Promise<boolean> {
        const table: string = this.escape(tableName);
        const declared: Map<string, string> = this.resolveDeclaredChecks(entity, tableName);
        const owned: StoredCheckRow[] = stored.filter(
            c => c.name.startsWith(PostgresSchemaManager.toStoredIdentifier(`chk_${tableName}_`))
        );
        const kept: Map<string, boolean> = new Map(owned.map(c => [c.name, c.valid]));

        const missing: [string, string][] = [...declared].filter(([name]) => !kept.has(name));
        for (const [name, predicate] of missing) {
            await this.inShortLock(
                run,
                `ALTER TABLE ${table} ADD CONSTRAINT ${this.escape(name)} CHECK ((${predicate}) IS TRUE) NOT VALID`
            );
        }
        // with the ones a boot that stopped in between left added and not validated
        for (const [name, predicate] of [...declared].filter(([n]) => kept.get(n) !== true)) {
            try {
                await run(`ALTER TABLE ${table} VALIDATE CONSTRAINT ${this.escape(name)}`);
            }
            catch (error) {
                await this.inShortLock(run, `ALTER TABLE ${table} DROP CONSTRAINT ${this.escape(name)}`);
                const [broken] = await run(`SELECT "id"::text AS "id" FROM ${table} WHERE NOT ((${predicate}) IS TRUE) LIMIT 1`);
                const check: KeyWhere | undefined = MetadataUtilities.getEntityMetadata(entity)?.checks
                    ?.find(c => keyWhereToSql(entity, c.where) === predicate)?.where;
                const constraint: string = check == undefined
                    ? predicate
                    : CheckConstraintViolationError.resolveProperties(check).join(', ');
                // read as text, and missing when no row breaks it any more
                const brokenId: unknown = broken?.['id'];
                throw new InternalError([
                    `Cannot hold ${entity.name} to the check on ${constraint}:`,
                    `the stored row ${typeof brokenId === 'string' ? brokenId : 'written meanwhile'} breaks it.`,
                    'Change the rows breaking it in a migration.'
                ], { cause: error });
            }
        }
        const abandoned: string[] = owned.map(c => c.name).filter(name => !declared.has(name));
        for (const name of abandoned) {
            await this.inShortLock(run, `ALTER TABLE ${table} DROP CONSTRAINT ${this.escape(name)}`);
        }
        return missing.length > 0 || abandoned.length > 0;
    }

    /**
     * Resolves the checks an entity declares, under the names they are stored by.
     * @param entity - The entity.
     * @param tableName - Its table.
     * @returns The condition of each, by its name.
     */
    private resolveDeclaredChecks(entity: Newable<BaseEntity>, tableName: string): Map<string, string> {
        return new Map((MetadataUtilities.getEntityMetadata(entity)?.checks ?? []).map(check => {
            const predicate: string = keyWhereToSql(entity, check.where);
            return [PostgresSchemaManager.toStoredIdentifier(checkConstraintName(tableName, predicate)), predicate];
        }));
    }

    /**
     * Builds the statements creating every index and unique an entity declares, and the trigram index
     * of every property a search reads.
     * @param entity - The entity.
     * @returns Each one, under the name the schema gives it.
     */
    private resolveDeclaredKeys(entity: Newable<BaseEntity>): DeclaredKey[] {
        const tableName: string = this.schema.getTable(entity).name;
        const table: string = this.escape(tableName);
        const columnsOf: (properties: string[]) => string[] = properties => properties
            .map(p => this.escape(this.schema.getColumn(entity, p).name));
        const groups: KeyGroups = keyGroupsOf(entity);
        const res: DeclaredKey[] = [];
        for (const unique of groups.uniques) {
            const columns: string[] = columnsOf(unique.properties);
            // the function the schema writes the condition with, so the name it hashes is the same
            const where: string | undefined = unique.where == undefined || coversEveryRow(unique.where)
                ? undefined
                : keyWhereToSql(entity, unique.where);
            const name: string = uniqueConstraintName(tableName, unique.properties, where);
            const quoted: string = this.escape(name);
            const list: string = columns.join(', ');
            // rows holding no value in one of the columns never conflict, which is how the index counts them
            const valued: string = columns.map(c => `${c} IS NOT NULL`).join(' AND ');
            const whereSql: string = where == undefined ? '' : ` WHERE ${where}`;
            const andWhereSql: string = where == undefined ? '' : ` AND (${where})`;
            const definition: string = `${quoted} ON ${table} (${list})${whereSql}`;
            res.push({
                name,
                properties: unique.properties,
                build: `CREATE UNIQUE INDEX CONCURRENTLY ${definition}`,
                buildOnEmptyTable: `CREATE UNIQUE INDEX ${definition}`,
                constrain: where == undefined ? `ALTER TABLE ${table} ADD CONSTRAINT ${quoted} UNIQUE USING INDEX ${quoted}` : undefined,
                duplicates: `SELECT json_build_array(${list})::text AS "values" FROM ${table} WHERE ${valued}${andWhereSql}`
                    + ` GROUP BY ${list} HAVING count(*) > 1 LIMIT 3`
            });
        }
        for (const index of groups.indexes) {
            const name: string = indexName(tableName, index);
            const definition: string = `${this.escape(name)} ON ${table} (${columnsOf(index).join(', ')})`;
            res.push({
                name,
                properties: index,
                build: `CREATE INDEX CONCURRENTLY ${definition}`,
                buildOnEmptyTable: `CREATE INDEX ${definition}`,
                constrain: undefined,
                duplicates: undefined
            });
        }
        // without the extension there is no operator class to build these with, and the warning that
        // says so has already been given
        if (this.trigram.threshold != undefined) {
            for (const property of this.findSearchableProperties(entity)) {
                const name: string = trigramIndexName(tableName, property);
                const definition: string = `${this.escape(name)} ON ${table} USING GIN (${columnsOf([property]).join('')} gin_trgm_ops)`;
                res.push({
                    name,
                    properties: [property],
                    build: `CREATE INDEX CONCURRENTLY ${definition}`,
                    buildOnEmptyTable: `CREATE INDEX ${definition}`,
                    constrain: undefined,
                    duplicates: undefined
                });
            }
        }
        return res;
    }

    /**
     * Creates one declared index or unique over the rows already stored.
     * @param run - Runs a statement.
     * @param entity - The entity declaring it.
     * @param key - What it is.
     * @throws When stored rows break the unique, naming the values they share.
     */
    private async createDeclaredKey(run: PostgresRun, entity: Newable<BaseEntity>, key: DeclaredKey): Promise<void> {
        // looked for first, so that the failure names the values rather than leaving that to the build
        await this.validateNoDuplicates(run, entity, key);
        try {
            await run(key.build);
        }
        catch (error) {
            await run(`DROP INDEX CONCURRENTLY IF EXISTS ${this.escape(key.name)}`);
            // a row written meanwhile can break a unique the stored rows kept a moment ago
            await this.validateNoDuplicates(run, entity, key);
            throw error;
        }
        if (key.constrain != undefined) {
            await this.inShortLock(run, key.constrain);
        }
    }

    private async validateNoDuplicates(run: PostgresRun, entity: Newable<BaseEntity>, key: DeclaredKey): Promise<void> {
        if (key.duplicates == undefined) {
            return;
        }
        const rows: Record<string, unknown>[] = await run(key.duplicates);
        if (!rows.length) {
            return;
        }
        throw new InternalError([
            `Cannot keep ${entity.name} unique by ${key.properties.join(', ')}:`,
            `the stored rows hold ${rows.map(r => String(r['values'])).join(', ')} more than once.`,
            'Remove the duplicates in a migration.'
        ]);
    }

    /**
     * Runs a statement that takes the whole table, giving up rather than waiting long for it: every read
     * and write of the table queues behind a statement waiting for that lock.
     * @param run - Runs a statement.
     * @param statement - The statement.
     */
    private async inShortLock(run: PostgresRun, statement: string): Promise<void> {
        await run('BEGIN');
        try {
            await run(`SET LOCAL lock_timeout = ${inject(ZIBRI_DI_TOKENS.SCHEMA_LOCK_TIMEOUT_IN_MS)}`);
            await run(statement);
            await run('COMMIT');
        }
        catch (error) {
            await run('ROLLBACK');
            throw error;
        }
    }

    private async readStoredKeys(run: PostgresRun, tableNames: string[]): Promise<StoredKeyRow[]> {
        return (await run(STORED_KEYS_SQL, [tableNames, DECLARED_KEY_COMMENT])).map(row => ({
            table: String(row['table']),
            name: String(row['name']),
            valid: row['valid'] === true,
            constraint: row['constraint'] === true,
            marked: row['marked'] === true
        }));
    }

    private async readStoredChecks(run: PostgresRun, tableNames: string[]): Promise<StoredCheckRow[]> {
        return (await run(STORED_CHECKS_SQL, [tableNames])).map(row => ({
            table: String(row['table']),
            name: String(row['name']),
            valid: row['valid'] === true
        }));
    }

    // ── warnings ────────────────────────────────────────────────

    /**
     * Reports the text columns that are not ordered the way the rest of the application orders text:
     * a filter or an order on them answers something else than the same filter does in process.
     * @param run - Runs a statement.
     * @param collation - The collation the application orders text by.
     */
    async warnAboutColumnsOrderedDifferently(run: PostgresRun, collation: string): Promise<void> {
        const tables: string[] = this.schema.tables.map(t => t.name);
        if (!tables.length) {
            return;
        }
        const differing: Record<string, unknown>[] = await run(
            'SELECT table_name, column_name, collation_name FROM information_schema.columns'
            + ' WHERE table_schema = current_schema() AND table_name = ANY($1) AND collation_name IS NOT NULL AND collation_name <> $2',
            [tables, collation]
        );
        if (!differing.length) {
            return;
        }
        this.logger.warn(
            `These columns are not ordered by "${collation}", so a filter or an order on them answers something else`
            + ' than the same filter or order does in process:'
            + differing.map(c => `\n- ${String(c['table_name'])}.${String(c['column_name'])} is "${String(c['collation_name'])}"`).join('')
        );
    }

    /**
     * Reports the searchable columns that have no trigram index on a schema somebody outside the
     * application owns: nothing here adds the index, and a search of them would read the whole table.
     * @param run - Runs a statement.
     */
    async warnAboutMissingTrigramIndexes(run: PostgresRun): Promise<void> {
        if (this.trigram.threshold == undefined) {
            return;
        }
        const declared: [string, string, string][] = this.entities.flatMap(
            entity => this.findSearchableProperties(entity).map((property): [string, string, string] => {
                const table: string = this.schema.getTable(entity).name;
                return [trigramIndexName(table, property), table, this.schema.getColumn(entity, property).name];
            })
        );
        if (!declared.length) {
            return;
        }
        const existing: Set<string> = new Set((await run(
            'SELECT indexname AS "name" FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ANY($1) AND indexname LIKE $2',
            [this.schema.tables.map(t => t.name), `${TRIGRAM_INDEX_PREFIX}%`]
        )).map(row => String(row['name'])));
        const missing: [string, string, string][] = declared.filter(([name]) => !existing.has(name));
        if (!missing.length) {
            return;
        }
        this.logger.warn(
            'These columns are searchable with "fuzzyLike" and have no trigram index, so a search of them'
            + ' reads every row. Create one per column, as'
            + ' CREATE INDEX "name" ON "table" USING GIN ("column" gin_trgm_ops), or declare'
            + ' fuzzySearchable: false on the property:'
            + missing.map(([name, table, column]) => `\n- ${table}.${column}, as "${name}"`).join('')
        );
    }

    /**
     * Finds the tables a write changes more than its own rows of: those with a trigger, and those a
     * foreign key the entities do not declare points at with an action that changes the rows
     * pointing at them.
     *
     * What a spanning transaction cannot undo, since it restores the rows it wrote and nothing such
     * a write changed besides them.
     * @param run - Runs a statement.
     * @returns By table, what else a write to it changes.
     */
    async findUnrestorableTables(run: PostgresRun): Promise<Map<string, string>> {
        const declared: PostgresForeignKey[] = this.schema.tables.flatMap(table => table.foreignKeys);
        const res: Map<string, string> = new Map();
        for (const row of await run(CHANGING_DEPENDENTS_SQL)) {
            const table: string = String(row['table']);
            const name: string = String(row['name']);
            if (row['kind'] === 'trigger') {
                res.set(table, `the trigger "${name}"`);
                continue;
            }
            // the relations' own keys cascade too: the rows they remove are removed through their
            // repositories first, and the join rows go back along with the row they belong to
            const ownKey: boolean = declared.some(fk => fk.name === name
                && fk.onDelete === this.findDeclaredAction(row['onDelete'])
                && fk.onUpdate === this.findDeclaredAction(row['onUpdate']));
            if (!ownKey) {
                res.set(table, `the foreign key "${name}" of "${String(row['dependent'])}"`);
            }
        }
        return res;
    }

    /**
     * Finds the action a stored foreign key takes as the entities would declare it.
     * @param stored - The action, as the catalog holds it.
     * @returns The declared action, undefined for one the entities never declare.
     */
    private findDeclaredAction(stored: unknown): PostgresReferentialAction | undefined {
        switch (stored) {
            case 'c': {
                return 'CASCADE';
            }
            case 'a': {
                return 'NO ACTION';
            }
            default: {
                return undefined;
            }
        }
    }

    private findSearchableProperties(entity: Newable<BaseEntity>): string[] {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entity);
        return ObjectUtilities.entries(properties)
            .filter(([, metadata]) => FuzzySearchUtilities.isSearchable(metadata))
            .map(([key]) => key);
    }

    private escape(name: string): string {
        return PostgresSqlUtilities.escapeIdentifier(name);
    }
}