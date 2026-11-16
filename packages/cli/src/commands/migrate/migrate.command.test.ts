import { readFile, writeFile } from 'node:fs/promises';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { MigrateCommand } from './migrate.command';
import { emptyWorkDirectory } from '../../__testing__/empty-work-directory.function';
import { GeneratedProject } from '../../__testing__/generated-project';
import { mockExitGracefully, ProcessExitError } from '../../__testing__/mock-exit-gracefully.function';
import { quietly } from '../../__testing__/quietly.function';
import { CPUtilities, FsUtilities } from '../../encapsulation';
import { Path } from '../../utilities';

const MIGRATIONS_DIR: string = 'src/data-sources/db/migrations';

let workDir: Path;
let project: GeneratedProject;
let execSpy: jest.SpiedFunction<typeof CPUtilities.exec>;

/**
 * What the application was asked for, in the order it was.
 */
let requests: unknown[] = [];

/**
 * Makes the project's build answer with the given migrations, the way the application does.
 * @param migrations - What it answers.
 * @param baselines - The snapshots it writes in place of migrations, for a baseline.
 */
function answerWith(migrations: Record<string, unknown>[], baselines?: Record<string, unknown>[]): void {
    execSpy.mockImplementation(async command => {
        const files: RegExpExecArray | null = /migrate generate "([^"]+)" "([^"]+)"/.exec(command);
        if (files?.[1] != undefined && files[2] != undefined) {
            requests.push(JSON.parse(await readFile(files[1], 'utf8')));
            await writeFile(files[2], JSON.stringify({ migrations, baselines }));
        }
    });
}

/**
 * A migration the application writes for the project's data source.
 * @param className - Its name.
 * @param fileName - The name of its file.
 * @returns The migration, with the snapshot to commit with it.
 */
function migrationOf(className: string, fileName: string): Record<string, unknown> {
    return {
        dataSource: 'DbDataSource',
        className,
        fileName,
        code: `// ${className}`,
        snapshot: { dataSource: 'DbDataSource', entities: { task: { className: 'Task', properties: {} } } }
    };
}

/**
 * Runs `zi migrate create` in the project.
 * @param args - What follows "create".
 */
async function create(...args: string[]): Promise<void> {
    await quietly(async () => new MigrateCommand().start(['migrate', 'create', ...args]));
}

// every migration was written by hand, and added to the data source
// by hand, with nothing comparing it to what the entities declare
describe('MigrateCommand', () => {

    beforeEach(async () => {
        process.env['GIT_CONFIG_GLOBAL'] = '/dev/null';
        process.env['GIT_CONFIG_NOSYSTEM'] = '1';
        workDir = await emptyWorkDirectory('migrate-command');
        execSpy = jest.spyOn(CPUtilities, 'exec').mockResolvedValue(undefined);
        project = await GeneratedProject.create(workDir, ['none', 'isLoggedIn', 'none']);
        execSpy.mockClear();
        requests = [];
    });

    afterEach(async () => {
        CPUtilities['cwd'] = undefined;
        delete process.env['GIT_CONFIG_GLOBAL'];
        delete process.env['GIT_CONFIG_NOSYSTEM'];
        jest.restoreAllMocks();
        await FsUtilities.rm(workDir);
    });

    it('builds the project and asks it for the migrations of every data source it declares', async () => {
        answerWith([migrationOf('CreateTaskMigration', 'create-task.migration.ts')]);

        await create();

        expect(execSpy.mock.calls.map(([command]) => command.split(' ').slice(0, 3)
            .join(' '))).toStrictEqual([
            'npm run build',
            'node "./dist/bundle.js" migrate'
        ]);
        expect(requests).toStrictEqual([{ dataSources: { DbDataSource: { import: '../db.data-source' } } }]);
    });

    it('puts the migration in place, with its snapshot, and adds it to the migrations its data source runs', async () => {
        answerWith([migrationOf('CreateTaskMigration', 'create-task.migration.ts')]);

        await create();

        expect(await project.read(`${MIGRATIONS_DIR}/create-task.migration.ts`)).toBe('// CreateTaskMigration');
        expect(JSON.parse(await project.read(`${MIGRATIONS_DIR}/entities.snapshot.json`))).toStrictEqual(migrationOf('', '')['snapshot']);
        const index: string = await project.read(`${MIGRATIONS_DIR}/index.ts`);
        expect(index).toContain('import { Migration, Newable } from \'zibri\';\n\nimport { CreateTaskMigration } from \'./create-task.migration\';\n');
        expect(index).toContain('export const migrations: Newable<Migration>[] = [\n    CreateTaskMigration\n];');
    });

    it('leaves what the project wrote into its migrations file as it wrote it', async () => {
        answerWith([migrationOf('CreateTaskMigration', 'create-task.migration.ts')]);
        await create();
        const original: string = await project.read(`${MIGRATIONS_DIR}/index.ts`);
        const written: string = `${original}\n// a note\twith a tab\n`;
        await project.write(`${MIGRATIONS_DIR}/index.ts`, written);
        answerWith([migrationOf('AddDueDateToTaskMigration', 'add-due-date-to-task.migration.ts')]);

        await create('AddDueDate');

        const index: string = await project.read(`${MIGRATIONS_DIR}/index.ts`);
        expect(index).toContain('// a note\twith a tab\n');
        expect(index.endsWith('\n')).toBe(true);
    });

    it('hands the committed snapshot over, and adds the next migration after the ones before it', async () => {
        answerWith([migrationOf('CreateTaskMigration', 'create-task.migration.ts')]);
        await create();
        answerWith([migrationOf('AddDueDateToTaskMigration', 'add-due-date-to-task.migration.ts')]);

        await create('AddDueDate');

        expect(requests[1]).toStrictEqual({
            name: 'AddDueDate',
            dataSources: { DbDataSource: { import: '../db.data-source', snapshot: migrationOf('', '')['snapshot'] } }
        });
        const index: string = await project.read(`${MIGRATIONS_DIR}/index.ts`);
        // the imports in the order of their paths, the entries in the order the migrations run
        expect(index).toContain([
            'import { AddDueDateToTaskMigration } from \'./add-due-date-to-task.migration\';',
            'import { CreateTaskMigration } from \'./create-task.migration\';'
        ].join('\n'));
        expect(index).toContain('[\n    CreateTaskMigration,\n    AddDueDateToTaskMigration\n]');
    });

    it('asks for an empty migration of the only data source', async () => {
        answerWith([{ ...migrationOf('CleanUpTasksMigration', 'clean-up-tasks.migration.ts'), snapshot: undefined }]);

        await create('CleanUpTasks', '--empty');

        expect(requests).toStrictEqual([{ name: 'CleanUpTasks', emptyFor: 'DbDataSource', dataSources: { DbDataSource: { import: '../db.data-source' } } }]);
        expect(await project.exists(`${MIGRATIONS_DIR}/entities.snapshot.json`)).toBe(false);
    });

    // a project moving from synchronize to migrations had its tables already, and its first
    // generated migration created them again
    it('commits the snapshot of a data source that has none, and no migration, for a baseline', async () => {
        const snapshot: unknown = migrationOf('', '')['snapshot'];
        answerWith([], [{ dataSource: 'DbDataSource', snapshot }]);
        const index: string = await project.read(`${MIGRATIONS_DIR}/index.ts`);

        await quietly(async () => new MigrateCommand().start(['migrate', 'baseline']));

        expect(requests).toStrictEqual([{ baseline: true, dataSources: { DbDataSource: { import: '../db.data-source' } } }]);
        expect(JSON.parse(await project.read(`${MIGRATIONS_DIR}/entities.snapshot.json`))).toStrictEqual(snapshot);
        expect(await project.read(`${MIGRATIONS_DIR}/index.ts`)).toBe(index);
    });

    it('refuses anything but "create" and "baseline"', async () => {
        mockExitGracefully();

        await expect(quietly(async () => new MigrateCommand().start(['migrate', 'up']))).rejects.toThrow(ProcessExitError);
        await expect(quietly(async () => new MigrateCommand().start(['migrate', 'baseline', 'Initial']))).rejects.toThrow(ProcessExitError);
        expect(execSpy).not.toHaveBeenCalled();
    });
});