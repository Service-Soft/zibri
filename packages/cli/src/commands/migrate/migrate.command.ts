/* eslint-disable no-console */
import path from 'node:path';

import { ChalkUtilities, CPUtilities, FsUtilities, InquirerUtilities } from '../../encapsulation';
import { exitWithError, getPath, Path } from '../../utilities';
import { BaseCommand } from '../base-command.model';

/**
 * The file a data source's snapshot is committed in, next to its migrations.
 */
const SNAPSHOT_FILE_NAME: string = 'entities.snapshot.json';

/**
 * Finds the classes a file declares as data sources.
 */
const DATA_SOURCE_DECLARATION: RegExp = /@DataSource\([^)]*\)\s*export\s+class\s+(\w+)/g;

/**
 * Finds the list of migrations a data source runs.
 */
const MIGRATIONS_LIST: RegExp = /(export const migrations\b[^=]*=\s*\[)([^\]]*)(])/;

/**
 * What `zi migrate create` or `zi migrate baseline` is asked for.
 */
type MigrateInput = {
    /**
     * Writes the migrations of what the entities changed.
     */
    action: 'create',
    /**
     * The folder of the project.
     */
    projectPath: Path,
    /**
     * The name the migrations are given, derived from what each changes when there is none.
     */
    name: string | undefined,
    /**
     * Whether to write a migration that changes nothing, for one of the developer's own.
     */
    empty: boolean
} | {
    /**
     * Writes the snapshot of every data source that has none, and no migration.
     */
    action: 'baseline',
    /**
     * The folder of the project.
     */
    projectPath: Path
};

/**
 * A data source a file of the project declares.
 */
type ProjectDataSource = {
    /**
     * The name of its class.
     */
    className: string,
    /**
     * The file declaring it.
     */
    file: Path,
    /**
     * The folder its migrations are in.
     */
    migrationsDir: Path,
    /**
     * Where a migration in that folder imports the class from.
     */
    importPath: string
};

/**
 * A migration the application wrote, as it hands it back.
 */
type WrittenMigration = {
    /**
     * The name of the data source's class.
     */
    dataSource: string,
    /**
     * The name of the migration's class.
     */
    className: string,
    /**
     * The name of its file.
     */
    fileName: string,
    /**
     * Its code.
     */
    code: string,
    /**
     * The snapshot to commit with it, if any.
     */
    snapshot?: unknown
};

/**
 * A snapshot the application wrote in place of a migration, for a baseline.
 */
type WrittenBaseline = {
    /**
     * The name of the data source's class.
     */
    dataSource: string,
    /**
     * The snapshot to commit.
     */
    snapshot: unknown
};

/**
 * What the application wrote: its migrations, and the snapshots of a baseline.
 */
type WrittenResponse = {
    /**
     * The migrations, one per data source whose entities changed.
     */
    migrations: WrittenMigration[],
    /**
     * The snapshots written in place of migrations, for a baseline.
     */
    baselines: WrittenBaseline[]
};

/**
 * The answer to which data source an empty migration is for.
 */
type EmptyForAnswer = {
    /**
     * The name of the data source's class.
     */
    dataSource: string
};

/**
 * How the commands are written, for the message refusing one that is not.
 */
const USAGE: string = '"zi migrate create [name] [--empty]" or "zi migrate baseline"';

/**
 * Writes the migrations of what the entities of the project in this folder changed since the last ones.
 *
 * What changed is decided by the project's own build, against the zibri version it is built with: it
 * compares what its entities declare with the snapshot committed next to each data source's migrations,
 * and writes the migration of the difference. This command puts each one in place and adds it to the
 * migrations its data source runs. A baseline commits the snapshot of every data source that has none,
 * and no migration, for a database that holds what the entities declare already.
 */
export class MigrateCommand extends BaseCommand<MigrateInput> {
    protected override maxLength: number | undefined = 4;

    // `zi migrate create [name] [--empty]`, `zi migrate baseline`
    protected override async resolveInput(args: string[]): Promise<MigrateInput> {
        const [, action, ...rest]: (string | undefined)[] = args;
        if (action === 'baseline' && !rest.length) {
            return { action: 'baseline', projectPath: getPath('.') };
        }
        if (action !== 'create') {
            return await exitWithError(`Write the migrations of what the entities changed with ${USAGE}.`);
        }
        const names: string[] = rest.filter((arg): arg is string => arg != undefined && arg !== '--empty');
        if (names.length > 1) {
            return await exitWithError('Name the migration once, as "zi migrate create [name] [--empty]".');
        }
        return { action: 'create', projectPath: getPath('.'), name: names[0], empty: rest.includes('--empty') };
    }

    protected override async run(input: MigrateInput): Promise<void> {
        const dataSources: ProjectDataSource[] = await this.findDataSources(input.projectPath);
        if (!dataSources.length) {
            await exitWithError('No file below "src" declares a data source with @DataSource().');
            return;
        }
        const emptyFor: string | undefined = input.action === 'create' && input.empty ? await this.resolveEmptyFor(dataSources) : undefined;
        const request: Record<string, unknown> = {
            ...input.action === 'create' ? { name: input.name, emptyFor } : { baseline: true },
            dataSources: Object.fromEntries(await Promise.all(dataSources.map(async d => [
                d.className,
                { import: d.importPath, snapshot: await this.readSnapshot(d) }
            ])))
        };

        const workDir: Path = await FsUtilities.mkdtemp('zibri-migrate-');
        try {
            const requestFile: Path = getPath(workDir, 'request.json');
            const responseFile: Path = getPath(workDir, 'response.json');
            await FsUtilities.createFile(requestFile, JSON.stringify(request), true, false);
            // the build the application runs from, with the entities as they are declared now
            await CPUtilities.exec('npm run build');
            const main: string = await this.resolveMain(input.projectPath);
            await CPUtilities.exec(`node "${main}" migrate generate "${requestFile}" "${responseFile}"`);
            const { migrations, baselines } = await this.readResponse(responseFile);
            for (const migration of migrations) {
                await this.writeMigration(await this.findDataSource(dataSources, migration.dataSource), migration);
            }
            for (const baseline of baselines) {
                await this.writeSnapshot(await this.findDataSource(dataSources, baseline.dataSource), baseline.snapshot);
            }
        }
        finally {
            await FsUtilities.rm(workDir);
        }
    }

    /**
     * Finds every data source a file below "src" declares.
     * @param projectPath - The folder of the project.
     * @returns The data sources, with where their migrations go.
     */
    private async findDataSources(projectPath: Path): Promise<ProjectDataSource[]> {
        const sourcePath: Path = getPath(projectPath, 'src');
        const res: ProjectDataSource[] = [];
        for (const relativePath of (await FsUtilities.findFiles(sourcePath)).filter(f => f.endsWith('.ts'))) {
            const file: Path = getPath(sourcePath, relativePath);
            for (const match of (await FsUtilities.readFile(file)).matchAll(DATA_SOURCE_DECLARATION)) {
                const className: string | undefined = match[1];
                if (className == undefined) {
                    continue;
                }
                const migrationsDir: Path = getPath(path.dirname(file), 'migrations');
                const importPath: string = path.relative(migrationsDir, file).replaceAll('\\', '/')
                    .replace(/\.ts$/, '');
                res.push({ className, file, migrationsDir, importPath: importPath.startsWith('.') ? importPath : `./${importPath}` });
            }
        }
        return res;
    }

    /**
     * Resolves the data source an empty migration is written for: the only one, or the one asked for.
     * @param dataSources - The data sources of the project.
     * @returns The name of its class.
     */
    private async resolveEmptyFor(dataSources: ProjectDataSource[]): Promise<string> {
        const [only] = dataSources;
        if (only != undefined && dataSources.length === 1) {
            return only.className;
        }
        const { dataSource } = await InquirerUtilities.prompt<EmptyForAnswer>({
            dataSource: {
                type: 'select',
                name: 'dataSource',
                message: 'Which data source is the empty migration for?',
                choices: dataSources.map(d => d.className)
            }
        });
        return dataSource;
    }

    /**
     * Reads the snapshot committed with a data source's migrations.
     * @param dataSource - The data source.
     * @returns What the file holds, or undefined before its first migration.
     */
    private async readSnapshot(dataSource: ProjectDataSource): Promise<unknown> {
        const file: Path = getPath(dataSource.migrationsDir, SNAPSHOT_FILE_NAME);
        return await FsUtilities.exists(file) ? JSON.parse(await FsUtilities.readFile(file)) : undefined;
    }

    /**
     * Resolves the file the project's build starts from.
     * @param projectPath - The folder of the project.
     * @returns The file its package.json names as its main one.
     */
    private async resolveMain(projectPath: Path): Promise<string> {
        const packageJson: unknown = JSON.parse(await FsUtilities.readFile(getPath(projectPath, 'package.json')));
        const main: unknown = typeof packageJson === 'object' && packageJson != undefined && 'main' in packageJson
            ? packageJson.main
            : undefined;
        return typeof main === 'string' ? main : 'dist/index.js';
    }

    /**
     * Reads the migrations, and the snapshots of a baseline, the application wrote.
     * @param responseFile - The file it wrote them into.
     * @returns The migrations and the snapshots.
     */
    private async readResponse(responseFile: Path): Promise<WrittenResponse> {
        const response: unknown = JSON.parse(await FsUtilities.readFile(responseFile));
        if (typeof response !== 'object' || response == undefined || !('migrations' in response) || !Array.isArray(response.migrations)) {
            return await exitWithError('The application answered no migrations.');
        }
        const migrations: WrittenMigration[] = [];
        for (const migration of response.migrations) {
            if (!this.isWrittenMigration(migration)) {
                return await exitWithError('The application answered a migration without its data source, name, file or code.');
            }
            migrations.push(migration);
        }
        const baselines: unknown[] = 'baselines' in response && Array.isArray(response.baselines) ? response.baselines : [];
        return { migrations, baselines: baselines.filter(b => this.isWrittenBaseline(b)) };
    }

    private isWrittenMigration(value: unknown): value is WrittenMigration {
        return typeof value === 'object' && value != undefined
            && 'dataSource' in value && typeof value.dataSource === 'string'
            && 'className' in value && typeof value.className === 'string'
            && 'fileName' in value && typeof value.fileName === 'string'
            && 'code' in value && typeof value.code === 'string';
    }

    private isWrittenBaseline(value: unknown): value is WrittenBaseline {
        return typeof value === 'object' && value != undefined
            && 'dataSource' in value && typeof value.dataSource === 'string'
            && 'snapshot' in value && typeof value.snapshot === 'object' && value.snapshot != undefined;
    }

    /**
     * Finds the data source the application wrote a migration or a snapshot for.
     * @param dataSources - The data sources of the project.
     * @param className - The name of its class, as the application wrote it.
     * @returns The data source.
     */
    private async findDataSource(dataSources: ProjectDataSource[], className: string): Promise<ProjectDataSource> {
        const dataSource: ProjectDataSource | undefined = dataSources.find(d => d.className === className);
        if (dataSource == undefined) {
            return await exitWithError(`The application wrote for "${className}", which no file of the project declares.`);
        }
        return dataSource;
    }

    /**
     * Puts a migration in place: its file, the snapshot committed with it, and its entry in the
     * migrations its data source runs.
     * @param dataSource - The data source.
     * @param migration - The migration.
     */
    private async writeMigration(dataSource: ProjectDataSource, migration: WrittenMigration): Promise<void> {
        const file: Path = getPath(dataSource.migrationsDir, migration.fileName);
        if (await FsUtilities.exists(file)) {
            await exitWithError(`"${file}" exists already. Name the migration, as "zi migrate create <name>".`);
            return;
        }
        await FsUtilities.createFile(file, migration.code);
        if (migration.snapshot != undefined) {
            await this.writeSnapshot(dataSource, migration.snapshot);
        }
        await this.addToMigrations(getPath(dataSource.migrationsDir, 'index.ts'), migration);

        const declaration: string = await FsUtilities.readFile(dataSource.file);
        if (!/import {[^}]*\bmigrations\b[^}]*} from '\.\/migrations'/.test(declaration)) {
            console.log(ChalkUtilities.error(
                `${dataSource.className} does not run the migrations of "${getPath(dataSource.migrationsDir, 'index.ts')}".`,
                'Import "migrations" from "./migrations" in its file,'
                + ' and declare "override migrations: Newable<Migration>[] = migrations;" on it.'
            ));
        }
    }

    /**
     * Commits a snapshot next to a data source's migrations, in place of the one before.
     * @param dataSource - The data source.
     * @param snapshot - The snapshot.
     */
    private async writeSnapshot(dataSource: ProjectDataSource, snapshot: unknown): Promise<void> {
        const snapshotFile: Path = getPath(dataSource.migrationsDir, SNAPSHOT_FILE_NAME);
        // written as it is, so the line break it ends with stays
        await FsUtilities.writeFileBuffer(snapshotFile, Buffer.from(`${JSON.stringify(snapshot, undefined, 4)}\n`));
    }

    /**
     * Adds a migration to the end of the migrations a data source runs, and imports it.
     * @param indexFile - The file exporting them.
     * @param migration - The migration.
     */
    private async addToMigrations(indexFile: Path, migration: WrittenMigration): Promise<void> {
        const importLine: string = `import { ${migration.className} } from './${migration.fileName.replace(/\.ts$/, '')}';`;
        const current: string = await FsUtilities.exists(indexFile) ? await FsUtilities.readFile(indexFile) : '';
        if (!current.trim().length) {
            const created: string[] = [
                'import { Migration, Newable } from \'zibri\';',
                '',
                importLine,
                '',
                '/**',
                ' * The migrations of the data source, in the order they run. "zi migrate create" adds each one it',
                ' * writes.',
                ' */',
                `export const migrations: Newable<Migration>[] = [\n    ${migration.className}\n];`
            ];
            await (current.length ? FsUtilities.updateFile(indexFile, created, 'replace') : FsUtilities.createFile(indexFile, created));
            return;
        }
        const list: RegExpExecArray | null = MIGRATIONS_LIST.exec(current);
        if (list == undefined) {
            await exitWithError([
                `"${indexFile}" exports no list "migrations" to add "${migration.className}" to.`,
                'Export one, as "export const migrations: Newable<Migration>[] = [];", and run the migrations of the data source from it.'
            ].join(' '));
            return;
        }
        const [whole, start, entries = '', end] = list;
        const names: string[] = [
            ...entries.split(',').map(e => e.trim())
                .filter(e => e.length), migration.className
        ];
        const withEntry: string = current.replace(whole, `${start}\n    ${names.join(',\n    ')}\n${end}`);
        // as the project wrote it, its tabs and its last line break included: the generated-file
        // writes turn tabs into spaces and drop a trailing line break
        await FsUtilities.writeFileBuffer(indexFile, Buffer.from(this.addImport(withEntry, importLine)));
    }

    /**
     * Adds an import of a file of the project, among the others in the order of their paths.
     * @param content - The content of the file.
     * @param importLine - The import.
     * @returns The content with the import.
     */
    private addImport(content: string, importLine: string): string {
        const lines: string[] = content.split('\n');
        const modulePath: (line: string) => string | undefined = line => /^import .* from '(\.[^']*)';$/.exec(line)?.[1];
        const relative: number[] = lines.map((line, i) => modulePath(line) == undefined ? -1 : i).filter(i => i >= 0);
        const added: string = modulePath(importLine) ?? '';
        if (!relative.length) {
            // the first import of a file of the project, below those of packages, apart from them
            const lastImport: number = lines.reduce(
                (last, line, i) => line.startsWith('import ') || line.includes('} from \'') ? i : last,
                -1
            );
            lines.splice(lastImport + 1, 0, ...lastImport < 0 ? [importLine, ''] : ['', importLine]);
            return lines.join('\n');
        }
        const before: number | undefined = relative.find(i => (modulePath(lines[i] ?? '') ?? '') > added);
        lines.splice(before ?? (relative.at(-1) ?? 0) + 1, 0, importLine);
        return lines.join('\n');
    }
}