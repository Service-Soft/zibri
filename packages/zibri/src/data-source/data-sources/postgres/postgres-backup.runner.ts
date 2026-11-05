
import { ChildProcessByStdio, spawn } from 'node:child_process';
import { PassThrough, Readable, Writable } from 'node:stream';

import { PostgresClientToolUtilities } from './postgres-client-tool.utilities';
import { type PostgresDataSource, type PostgresOptions } from './postgres-data-source.model';
import { PostgresRestoreSqlUtilities } from './postgres-restore-sql.utilities';
import { PostgresSchema } from './postgres-schema.model';
import { PostgresSqlUtilities } from './postgres-sql.utilities';
import { BaseEntity } from '../../../entity/base-entity.model';
import { isRelationMetadata } from '../../../entity/models/is-relation-metadata.function';
import { Relation } from '../../../entity/models/relation.enum';
import { InternalError } from '../../../error-handling/internal-error.model';
import { Newable } from '../../../types/newable.type';
import { MetadataUtilities } from '../../../utilities/metadata.utilities';

const DUMP_COMMAND: string = 'pg_dump';
/**
 * Writes an archive of DUMP_COMMAND out as the statements that recreate what it holds.
 */
const ARCHIVE_COMMAND: string = 'pg_restore';
const RESTORE_COMMAND: string = 'psql';
const DEFAULT_PORT: number = 5432;

/**
 * Makes and restores the backups of a postgres data source, through the postgres client tools.
 */
export class PostgresBackupRunner {

    constructor(
        private readonly dataSource: PostgresDataSource,
        private readonly getSchema: () => PostgresSchema
    ) {}

    /**
     * Validates that the data source is configured to be backed up, and that the client tools a backup
     * runs are installed in versions that can dump and restore its server.
     * @throws When something is missing or the versions do not fit.
     */
    async validateConfiguration(): Promise<void> {
        const { backupScope, rootUsername, rootPw, options } = this.dataSource;
        if (backupScope == undefined) {
            throw new InternalError(
                'Invalid data source marked with @Backup: backupScope is not set.'
                + ' Set \'schema\' to back up everything in the schema the data source works in,'
                + ' or \'entity-tables\' to back up the tables of its entities and leave the rest of the schema alone.'
            );
        }
        if (Boolean(rootUsername) !== Boolean(rootPw)) {
            throw new InternalError(
                'Invalid data source marked with @Backup: rootUsername and rootPw belong together.'
                + ' Set both to back up as a separate role, or neither to use the data source\'s own credentials.'
            );
        }
        const { host, database } = options;
        if (!host || !database || !this.backupUsername) {
            throw new InternalError('Invalid data source marked with @Backup: host, database and username need to be resolvable');
        }
        // the binaries are the dependency nobody remembers to put in the image, and the moment it is
        // discovered by accident is the moment a restore is needed. Boot is a cheaper place to find out
        const versions: Partial<Record<string, number>> = {};
        const env: NodeJS.ProcessEnv = this.resolveClientEnvironment(undefined);
        for (const command of [DUMP_COMMAND, ARCHIVE_COMMAND, RESTORE_COMMAND]) {
            const version: number | undefined = await PostgresClientToolUtilities.findMajorVersion(command, env);
            if (version == undefined) {
                throw new InternalError(
                    `Invalid data source marked with @Backup: "${command}" was not found on PATH.`
                    + ' Backups shell out to the postgres client tools, so they have to be installed in the runtime image.'
                );
            }
            versions[command] = version;
        }
        // pg_dump refuses a server newer than itself, and pg_restore an archive of a pg_dump newer than
        // itself - both only once a backup or a restore is attempted
        const [row] = await this.dataSource.runStatement({ sql: 'SHOW server_version_num', parameters: {} });
        // eg. 170006 for 17.6
        const serverVersion: number = Math.floor(Number(row?.['server_version_num']) / 10000);
        const dumpVersion: number | undefined = versions[DUMP_COMMAND];
        const archiveVersion: number | undefined = versions[ARCHIVE_COMMAND];
        if (dumpVersion != undefined && dumpVersion < serverVersion) {
            throw new InternalError(
                `Invalid data source marked with @Backup: "${DUMP_COMMAND}" is version ${dumpVersion}`
                + ` and the server version ${serverVersion}.`
                + ' A dump needs client tools of the server\'s version or later,'
                + ` so install those of version ${serverVersion} in the runtime image.`
            );
        }
        if (dumpVersion != undefined && archiveVersion != undefined && archiveVersion < dumpVersion) {
            throw new InternalError(
                `Invalid data source marked with @Backup: "${ARCHIVE_COMMAND}" is version ${archiveVersion}`
                + ` and "${DUMP_COMMAND}" version ${dumpVersion}.`
                + ' A restore reads what a dump wrote, so install the client tools of one version in the runtime image.'
            );
        }
    }

    /**
     * Dumps what a backup of the data source covers, as an archive.
     * @returns A stream of the dump, which fails when the dump fails.
     */
    async createBackupData(): Promise<Readable> {
        const schema: string = await this.resolveSchemaName();
        const args: string[] = [
            ...this.resolveClientConnectionArgs(),
            '--format',
            'custom',
            // a pattern, where double quotes take the name as it is written
            ...this.dataSource.backupScope === 'entity-tables'
                ? this.getQualifiedEntityTableNames(schema).flatMap(table => ['--table', table])
                : ['--schema', `"${schema.replaceAll('"', '""')}"`],
            // their tables, which a restore recreates, without the rows, which a restore keeps
            ...this.resolveQualifiedTableNamesNotBackedUp(schema).flatMap(table => ['--exclude-table-data', table])
        ];
        const child: ChildProcessByStdio<null, Readable, Readable> = spawn(DUMP_COMMAND, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: this.resolveClientEnvironment(await this.resolveBackupPassword())
        });
        const stderr: () => string = PostgresClientToolUtilities.keepStderrTail(child.stderr);
        const out: PassThrough = new PassThrough();
        // ended here rather than by the pipe, which would end it on a dump that failed halfway as well,
        // and on close rather than exit: a child can exit before what it wrote has all been read, and
        // ending it then refuses the rest
        child.stdout.pipe(out, { end: false });
        child.on('error', error => {
            out.destroy(error);
        });
        child.on('close', code => {
            if (code !== 0) {
                out.destroy(PostgresClientToolUtilities.resolveExitError(DUMP_COMMAND, code, stderr()));
            }
            else {
                out.end();
            }
        });
        return out;
    }

    /**
     * Applies a dump produced by {@link createBackupData} to the data source's database.
     *
     * `ON_ERROR_STOP` and `--single-transaction` are what make the result mean something: the restore
     * either lands whole or is rolled back and raised. The dump carries no `DROP`, so the restore clears
     * what it is about to recreate itself, see {@link PostgresRestoreSqlUtilities.resolveClearSchema}. Of
     * a backup of the entity tables, it clears those tables alone, and is refused when anything else
     * depends on one.
     *
     * A restore replaces the objects it dumps, so the role running it has to own them, and every object
     * goes back to the role that owned it when the backup was taken.
     * @param backupData - The dump to apply.
     */
    async applyBackup(backupData: Readable): Promise<void> {
        const schema: string = await this.resolveSchemaName();
        const env: NodeJS.ProcessEnv = this.resolveClientEnvironment(await this.resolveBackupPassword());
        const entityTablesOnly: boolean = this.dataSource.backupScope === 'entity-tables';
        // the objects in the schema and nothing else of the archive, with their owners. Of the entity
        // tables, the archive's drops go first: a table an older build declared and this one does not is
        // still in the archive, and its create would fail on the table still there
        const reader: ChildProcessByStdio<Writable, Readable, Readable> = spawn(
            ARCHIVE_COMMAND,
            ['--schema', schema, ...entityTablesOnly ? ['--clean', '--if-exists'] : [], '--file', '-'],
            { stdio: ['pipe', 'pipe', 'pipe'], env }
        );
        const applier: ChildProcessByStdio<Writable, null, Readable> = spawn(
            RESTORE_COMMAND,
            [...this.resolveClientConnectionArgs(), '--quiet', '--set', 'ON_ERROR_STOP=1', '--single-transaction'],
            { stdio: ['pipe', 'inherit', 'pipe'], env }
        );
        // kept rather than inherited, so the error names the statement psql stopped at
        const applierStderr: () => string = PostgresClientToolUtilities.keepStderrTail(applier.stderr);

        const read: Promise<void> = PostgresClientToolUtilities.waitForExit(reader, ARCHIVE_COMMAND);
        // awaited inside the script, which a psql that stopped early no longer reads to the end of
        // eslint-disable-next-line promise/prefer-await-to-then
        read.catch(() => undefined);
        const clear: string = entityTablesOnly
            ? PostgresRestoreSqlUtilities.resolveClearTables(this.getQualifiedEntityTableNames(schema))
            : PostgresRestoreSqlUtilities.resolveClearSchema(schema);
        const kept: string[] = this.resolveQualifiedTableNamesNotBackedUp(schema);
        const script: Readable = Readable.from(PostgresRestoreSqlUtilities.resolveScript(
            PostgresRestoreSqlUtilities.resolveSetAsideKeptRows(kept) + clear,
            reader.stdout,
            read,
            PostgresRestoreSqlUtilities.resolvePutBackKeptRows(kept)
        ));

        await new Promise<void>((resolve, reject) => {
            let settled: boolean = false;
            const fail: (error: Error) => void = error => {
                if (settled) {
                    return;
                }
                settled = true;
                // psql commits what it was given once its input ends, so one that has not been given all
                // of it is stopped rather than left to reach an end
                reader.kill();
                applier.kill();
                reject(error);
            };
            // either child stopping on the first bad statement closes its stdin while it is still being
            // written, an EPIPE nobody listens for. Each one's exit code says why it stopped
            reader.stdin.on('error', () => backupData.destroy());
            applier.stdin.on('error', () => script.destroy());
            backupData.on('error', fail);
            script.on('error', fail);
            backupData.pipe(reader.stdin);
            script.pipe(applier.stdin);

            applier.on('error', fail);
            applier.on('close', code => {
                if (code !== 0) {
                    fail(PostgresClientToolUtilities.resolveExitError(RESTORE_COMMAND, code, applierStderr()));
                    return;
                }
                settled = true;
                resolve();
            });
        });
    }

    /**
     * Resolves the schema the data source works in, which is what a backup of it covers.
     * @returns The name of the schema.
     */
    private async resolveSchemaName(): Promise<string> {
        const [row] = await this.dataSource.runStatement({ sql: 'SELECT current_schema() AS schema', parameters: {} });
        const schema: unknown = row?.['schema'];
        // current_schema() is text, or null when no schema on the search_path exists
        if (typeof schema !== 'string') {
            throw new InternalError(
                'Could not back up or restore: the connection works in no schema, since none on its search_path exists'
            );
        }
        return schema;
    }

    /**
     * Gets the tables of the data source's entities and their join tables, qualified with the schema
     * and quoted - which is how a statement names them, and how the client tools take a name as written.
     * @param schema - The schema the data source works in.
     * @returns The tables.
     */
    private getQualifiedEntityTableNames(schema: string): string[] {
        return this.getSchema().tables.map(
            t => `${PostgresSqlUtilities.escapeIdentifier(schema)}.${PostgresSqlUtilities.escapeIdentifier(t.name)}`
        );
    }

    /**
     * Resolves the tables of the entities whose rows a backup leaves out and a restore keeps, qualified
     * by the schema the way the dump names them. Each after the tables its rows point at, which is the
     * order the rows go back in.
     * @param schema - The schema the data source works in.
     * @returns The qualified table names.
     */
    private resolveQualifiedTableNamesNotBackedUp(schema: string): string[] {
        return this.resolveEntitiesNotBackedUpInReferenceOrder()
            .map(entity => MetadataUtilities.getEntityMetadata(entity))
            .flatMap(metadata => metadata == undefined
                ? []
                : [`${PostgresSqlUtilities.escapeIdentifier(schema)}.${PostgresSqlUtilities.escapeIdentifier(metadata.tableName)}`]);
    }

    /**
     * The entities whose rows a backup leaves out and a restore keeps, each after the ones among them
     * its rows point at. The rows of one pointing at another cannot go back before the ones they point
     * at, whichever order the data source declares the two in.
     * @returns The entities, in that order.
     */
    private resolveEntitiesNotBackedUpInReferenceOrder(): Newable<BaseEntity>[] {
        const kept: Newable<BaseEntity>[] = this.dataSource.entities.filter(
            entity => MetadataUtilities.getEntityMetadata(entity)?.backedUp === false
        );
        const ordered: Newable<BaseEntity>[] = [];
        const visiting: Set<Newable<BaseEntity>> = new Set();
        const visit: (entity: Newable<BaseEntity>) => void = entity => {
            // an entity reached again while its targets are visited points at itself through them,
            // and there is no order for that: it goes where the walk first reached it
            if (ordered.includes(entity) || visiting.has(entity)) {
                return;
            }
            visiting.add(entity);
            for (const property of Object.values(MetadataUtilities.getModelProperties(entity))) {
                if (
                    isRelationMetadata(property)
                    && (property.type === Relation.MANY_TO_ONE || property.type === Relation.BELONGS_TO_ONE)
                    && kept.includes(property.target())
                ) {
                    visit(property.target());
                }
            }
            ordered.push(entity);
        };
        for (const entity of kept) {
            visit(entity);
        }
        return ordered;
    }

    /**
     * The options the server itself is reached with, which the client tools of a backup connect with:
     * a dump and a restore each hold one session for their whole run, which a transaction pooler would
     * not keep for them.
     * @returns The options, with the direct connection of a transaction pooler over them.
     */
    private get directOptions(): PostgresOptions {
        const { options, pooler } = this.dataSource;
        return { ...options, ...typeof pooler === 'object' ? pooler.direct : undefined };
    }

    /**
     * The role backups run as - the separate one if configured, otherwise the application's own.
     * @returns The username to connect the client tools with.
     */
    private get backupUsername(): string | undefined {
        return this.dataSource.rootUsername ?? this.directOptions.username;
    }

    /**
     * Resolves the password for {@link backupUsername}, which may be a callback that fetches from a
     * secret store.
     * @returns The password, or undefined if the connection does not use one.
     */
    private async resolveBackupPassword(): Promise<string | undefined> {
        if (this.dataSource.rootPw != undefined) {
            return this.dataSource.rootPw;
        }
        const password: PostgresOptions['password'] = this.directOptions.password;
        return typeof password === 'function' ? await password() : password;
    }

    /**
     * Resolves the environment the client tools are given.
     *
     * Deliberately not `process.env`, where the application's jwt secret, encryption master keys and
     * smtp credentials live - none of which `pg_dump` reads, and all of which a subprocess environment
     * is a way to hand to whatever can read `/proc/<pid>/environ`. Every `PG*` variable already present
     * is passed through, because that is how an operator configures tls for a managed postgres.
     *
     * Without one, the mode follows the connection's `ssl`. Libpq's own default is `prefer`, which falls
     * back to plaintext without saying so, so a backup would travel less protected than every query.
     * @param password - The password to pass, if there is one.
     * @returns The environment for the child process.
     */
    private resolveClientEnvironment(password: string | undefined): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = {};
        for (const key of ['PATH', 'LANG', 'LC_ALL', 'LC_MESSAGES']) {
            env[key] = process.env[key];
        }
        for (const key in process.env) {
            if (key.startsWith('PG')) {
                env[key] = process.env[key];
            }
        }
        env['PGSSLMODE'] ??= this.directOptions.ssl === false ? 'disable' : 'require';
        if (password != undefined) {
            env['PGPASSWORD'] = password;
        }
        return env;
    }

    /**
     * Resolves the connection arguments both client tools take.
     * @returns The host, port, user and database arguments.
     * @throws When the data source does not carry enough to address a database with.
     */
    private resolveClientConnectionArgs(): string[] {
        const { host, port, database } = this.directOptions;
        if (!host || !database || !this.backupUsername) {
            throw new InternalError('Could not run a postgres client tool, missing host, database or username on the data source');
        }
        // an omitted port means the postgres default, which is what the connection itself resolves it to
        return ['-h', host, '-p', (port ?? DEFAULT_PORT).toString(), '-U', this.backupUsername, '-d', database];
    }
}