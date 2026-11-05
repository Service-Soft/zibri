/* eslint-disable cspell/spellchecker */
import { Readable } from 'node:stream';

import { literalToSql } from '../../literal-to-sql.function';

/**
 * The statements a restore runs around the ones of the dump it applies.
 */
export abstract class PostgresRestoreSqlUtilities {

    /**
     * Resolves what the restore runs first in front of the dump's statements, and what it runs last
     * behind them, as one stream, so that all of it is inside psql's single transaction.
     *
     * Ends only once the archive was read whole. Psql commits whatever it was given when its input ends,
     * so the statements of an archive that stopped part way must not reach an end at all: an error here
     * leaves psql's input open, and psql is stopped before it commits.
     * @param preamble - What runs before the dump's statements.
     * @param statements - The dump's statements.
     * @param read - Settles once the archive was read, and fails when it could not be.
     * @param epilogue - What runs after the dump's statements.
     * @yields The preamble, the statements, then the epilogue.
     */
    static async* resolveScript(
        preamble: string,
        statements: Readable,
        read: Promise<void>,
        epilogue: string
    ): AsyncGenerator<string | Buffer> {
        yield preamble;
        yield* statements;
        await read;
        yield epilogue;
    }

    /**
     * Resolves what clears what a dump of the schema is about to recreate, as the first statement of the
     * restore.
     *
     * This is what `pg_dump --clean` would otherwise do, and the reason it does not: `--clean` drops
     * every object it dumped, and asking it for a schema makes the schema one of them. `DROP SCHEMA`
     * fails whenever an extension lives there, which is always - and it would be wrong even if it
     * succeeded. Dropping the schema an application stores its tables in is the same over-reach as
     * dumping the cluster an application stores its database in. And `--clean` drops only what the dump
     * holds, so a table created after the backup would outlive its restore, and the next migration
     * creating it again would fail.
     *
     * Every object of the schema a dump of it recreates, and nothing in any other schema: the tables,
     * views, sequences, types, domains, routines, operators, collations, conversions and text search
     * configurations and dictionaries. Not what goes with something else - an index, a table's row type,
     * an array type, a sequence a column owns, a range's constructors - and not what belongs to an
     * extension, which the extension recreates rather than the dump, and which postgres refuses to drop
     * anyway. Collected before the first drop, because a drop cascading to another object leaves it
     * nothing for `pg_identify_object` to name.
     *
     * Runs inside psql's `--single-transaction`, so a restore that then fails takes the drops back with
     * it rather than leaving an empty schema behind.
     * @param schema - The schema the data source works in.
     * @returns The statement.
     */
    static resolveClearSchema(schema: string): string {
        const owned: (catalog: string, alias: string) => string = (catalog, alias) => 'NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d'
            + ` WHERE d.classid = 'pg_catalog.${catalog}'::regclass AND d.objid = ${alias}.oid AND d.deptype IN ('e', 'a', 'i'))`;
        return `
DO $zibri$
DECLARE
    schema_oid oid := (SELECT oid FROM pg_catalog.pg_namespace WHERE nspname = ${literalToSql(schema)});
    drops text[];
    drop_statement text;
BEGIN
    SELECT coalesce(array_agg(o.statement), '{}') INTO drops FROM (
        SELECT format('DROP %s IF EXISTS %s CASCADE',
            CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'f' THEN 'FOREIGN TABLE'
                WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END,
            c.oid::regclass) AS statement
        FROM pg_catalog.pg_class c
        WHERE c.relnamespace = schema_oid AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S') AND ${owned('pg_class', 'c')}
        UNION ALL
        SELECT format('DROP %s IF EXISTS %s CASCADE', CASE t.typtype WHEN 'd' THEN 'DOMAIN' ELSE 'TYPE' END, t.oid::regtype)
        FROM pg_catalog.pg_type t
        WHERE t.typnamespace = schema_oid AND t.typtype IN ('c', 'd', 'e', 'r') AND ${owned('pg_type', 't')}
            AND (t.typtype <> 'c' OR (SELECT r.relkind FROM pg_catalog.pg_class r WHERE r.oid = t.typrelid) = 'c')
        UNION ALL
        SELECT format('DROP %s IF EXISTS %s CASCADE', CASE p.prokind WHEN 'a' THEN 'AGGREGATE' ELSE 'ROUTINE' END, p.oid::regprocedure)
        FROM pg_catalog.pg_proc p
        WHERE p.pronamespace = schema_oid AND ${owned('pg_proc', 'p')}
        UNION ALL
        SELECT format('DROP OPERATOR IF EXISTS %s CASCADE', o.oid::regoperator)
        FROM pg_catalog.pg_operator o
        WHERE o.oprnamespace = schema_oid AND ${owned('pg_operator', 'o')}
        UNION ALL
        SELECT format('DROP COLLATION IF EXISTS %s CASCADE', l.oid::regcollation)
        FROM pg_catalog.pg_collation l
        WHERE l.collnamespace = schema_oid AND ${owned('pg_collation', 'l')}
        UNION ALL
        SELECT format('DROP CONVERSION IF EXISTS %I.%I CASCADE', ${literalToSql(schema)}, v.conname)
        FROM pg_catalog.pg_conversion v
        WHERE v.connamespace = schema_oid AND ${owned('pg_conversion', 'v')}
        UNION ALL
        SELECT format('DROP TEXT SEARCH CONFIGURATION IF EXISTS %s CASCADE', g.oid::regconfig)
        FROM pg_catalog.pg_ts_config g
        WHERE g.cfgnamespace = schema_oid AND ${owned('pg_ts_config', 'g')}
        UNION ALL
        SELECT format('DROP TEXT SEARCH DICTIONARY IF EXISTS %s CASCADE', y.oid::regdictionary)
        FROM pg_catalog.pg_ts_dict y
        WHERE y.dictnamespace = schema_oid AND ${owned('pg_ts_dict', 'y')}
    ) o;
    FOREACH drop_statement IN ARRAY drops LOOP
        EXECUTE drop_statement;
    END LOOP;
END
$zibri$;
`;
    }

    /**
     * Resolves what clears the tables of the data source's entities, as the first statement of a restore
     * that covers those tables alone. Without a cascade: a view or a foreign key of something else that
     * depends on one of them would go with it, and the restore brings back none of those, so the restore
     * is refused instead. All in one statement, so that the tables' references to each other do not count.
     * @param tables - The tables, qualified and quoted.
     * @returns The statement.
     */
    static resolveClearTables(tables: string[]): string {
        return `DROP TABLE IF EXISTS ${tables.join(', ')};\n`;
    }

    /**
     * Resolves what sets aside what the tables a restore keeps hold now, as the first statement of the
     * restore, before anything is cleared. {@link resolvePutBackKeptRows} Puts it back once the dump's
     * statements ran.
     *
     * Set aside rather than left out of the clear: a dump recreates every table it holds, those included,
     * so the table it finds has to be gone - and an archive taken before they were left out holds their
     * rows as well.
     * @param tables - The tables whose rows the restore keeps, qualified.
     * @returns The statement.
     */
    static resolveSetAsideKeptRows(tables: string[]): string {
        return tables.map((table, i) => `
DO $zibri$
BEGIN
    IF to_regclass(${literalToSql(table)}) IS NOT NULL THEN
        EXECUTE 'CREATE TEMP TABLE zibri_kept_${i} ON COMMIT DROP AS SELECT * FROM ' || ${literalToSql(table)};
    END IF;
END
$zibri$;
`).join('');
    }

    /**
     * Resolves what puts back what {@link resolveSetAsideKeptRows} set aside, in place of whatever the
     * dump wrote into those tables. Of the columns the table has after the restore, those the rows set
     * aside hold, since a dump of an older release may have created the table with others.
     *
     * The tables come each after the ones its rows point at, so the rows go back in that order, and what
     * the dump wrote is cleared in the reverse of it, so a cleared table is pointed at by nothing.
     * @param tables - The tables whose rows the restore keeps, qualified, in the same order.
     * @returns The statement.
     */
    static resolvePutBackKeptRows(tables: string[]): string {
        const clears: string[] = tables.map(table => `
DO $zibri$
BEGIN
    IF to_regclass(${literalToSql(table)}) IS NOT NULL THEN
        EXECUTE 'DELETE FROM ' || ${literalToSql(table)};
    END IF;
END
$zibri$;
`);
        const inserts: string[] = tables.map((table, i) => `
DO $zibri$
DECLARE
    kept_columns text;
BEGIN
    IF to_regclass('pg_temp.zibri_kept_${i}') IS NULL OR to_regclass(${literalToSql(table)}) IS NULL THEN
        RETURN;
    END IF;
    SELECT string_agg(quote_ident(a.attname), ', ') INTO kept_columns
    FROM pg_catalog.pg_attribute a
    WHERE a.attrelid = to_regclass(${literalToSql(table)}) AND a.attnum > 0 AND NOT a.attisdropped
        AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute k WHERE k.attrelid = to_regclass('pg_temp.zibri_kept_${i}')
            AND k.attname = a.attname AND k.attnum > 0 AND NOT k.attisdropped);
    IF kept_columns IS NOT NULL THEN
        EXECUTE 'INSERT INTO ' || ${literalToSql(table)} || ' (' || kept_columns || ')'
            || ' SELECT ' || kept_columns || ' FROM pg_temp.zibri_kept_${i}';
    END IF;
END
$zibri$;
`);
        return [...clears.reverse(), ...inserts].join('');
    }
}