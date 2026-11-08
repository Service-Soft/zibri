import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { AddCommand } from './add.command';
import { emptyWorkDirectory } from '../../__testing__/empty-work-directory.function';
import { GeneratedProject } from '../../__testing__/generated-project';
import { mockExitGracefully, ProcessExitError } from '../../__testing__/mock-exit-gracefully.function';
import { quietly } from '../../__testing__/quietly.function';
import { CPUtilities, FsUtilities } from '../../encapsulation';
import { ScaffoldUtilities } from '../../scaffold';
import { Path } from '../../utilities';
import { RemoveCommand } from '../remove/remove.command';

/**
 * Adding a feature to a project generated without it, the way `zi upgrade` brings
 * a release: its files are written, and its lines are merged into the files the project changed.
 */

const OPTIONS: string = 'src/application-options.base.ts';

let workDir: Path;
let project: GeneratedProject;
let execSpy: jest.SpiedFunction<typeof CPUtilities.exec>;

/**
 * Runs `zi add` in the project.
 * @param features - The features, as the command line names them.
 */
async function add(features: string): Promise<void> {
    await quietly(async () => new AddCommand().start(['a', features]));
}

describe('AddCommand', () => {

    beforeEach(async () => {
        process.env['GIT_CONFIG_GLOBAL'] = '/dev/null';
        process.env['GIT_CONFIG_NOSYSTEM'] = '1';
        workDir = await emptyWorkDirectory('add-command');
        execSpy = jest.spyOn(CPUtilities, 'exec').mockResolvedValue(undefined);
        project = await GeneratedProject.create(workDir, ['none', 'isLoggedIn', 'none']);
        execSpy.mockClear();
    });

    afterEach(async () => {
        CPUtilities['cwd'] = undefined;
        delete process.env['GIT_CONFIG_GLOBAL'];
        delete process.env['GIT_CONFIG_NOSYSTEM'];
        jest.restoreAllMocks();
        await FsUtilities.rm(workDir);
    });

    it('writes the files of the feature, and merges its lines into a file the project changed', async () => {
        const options: string = await project.read(OPTIONS);
        const changed: string = options.replace(
            ' * Everything this application is, apart from where it keeps its data.',
            ' * Everything this application is, apart from where it keeps its data. Owned by the platform team.'
        );
        await project.write(OPTIONS, changed);
        project.commitAll('names its owner');

        await add('pages');

        expect(await project.exists('src/controllers/page.controller.ts')).toBe(true);
        expect(await project.exists('src/templates/pages/home.tsx')).toBe(true);
        expect(await project.exists('postcss.config.js')).toBe(true);
        const merged: string = await project.read(OPTIONS);
        expect(merged).toContain('Owned by the platform team.');
        expect(merged).toContain('import { AppAuthController, HealthController, PageController } from \'./controllers\';');
        expect(merged).toContain('    controllers: [HealthController, PageController, AppAuthController],');
        expect((await project.resolveManifest()).answers.features).toEqual(['pages']);
    });

    it('installs what the feature needs, and nothing the project has', async () => {
        await add('pages');

        // the framework stays at the release it is on: adding a feature is not an upgrade
        const commands: string[] = execSpy.mock.calls.map(([command]) => command);
        expect(commands).toHaveLength(1);
        expect(commands[0]).toMatch(/&& npm i -D @tailwindcss\/postcss@4 css-loader@\S+ mini-css-extract-plugin@\S+ postcss@\S+ postcss-loader@\S+ tailwindcss@4$/);
    });

    it('is undone by removing the feature again', async () => {
        const generated: string = project.git('rev-parse', 'HEAD').trim();

        await add('pages,metricsDashboard');
        project.commitAll('zi add');
        await quietly(async () => new RemoveCommand().start(['r', 'pages,metricsDashboard']));

        expect(project.git('status', '--porcelain', '--untracked-files=all')).not.toBe('');
        project.commitAll('zi remove');
        expect(project.git('diff', '--name-only', generated, 'HEAD')).toBe('');
    });

    it('refuses a feature without the one it is built on, before changing anything', async () => {
        mockExitGracefully();

        await expect(add('mailingList')).rejects.toThrow(ProcessExitError);
        expect(execSpy).not.toHaveBeenCalled();
        expect(project.git('status', '--porcelain')).toBe('');
    });

    it('refuses a feature the project has already', async () => {
        await add('pages');
        project.commitAll('zi add');
        mockExitGracefully();

        await expect(add('pages')).rejects.toThrow(ProcessExitError);
    });

    it('refuses a project another release generated, which "zi upgrade" brings to this one first', async () => {
        await ScaffoldUtilities.writeManifest(project.appDir, { ...await project.resolveManifest(), version: '3.0.0-older' });
        project.commitAll('zi new, an older one');
        mockExitGracefully();

        await expect(add('pages')).rejects.toThrow(ProcessExitError);
        expect(execSpy).not.toHaveBeenCalled();
        expect(project.git('status', '--porcelain')).toBe('');
    });
});