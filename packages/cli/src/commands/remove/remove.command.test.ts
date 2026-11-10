import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { RemoveCommand } from './remove.command';
import { emptyWorkDirectory } from '../../__testing__/empty-work-directory.function';
import { EVERY_FEATURE } from '../../__testing__/generated-file-paths';
import { GeneratedProject } from '../../__testing__/generated-project';
import { mockExitGracefully, ProcessExitError } from '../../__testing__/mock-exit-gracefully.function';
import { quietly } from '../../__testing__/quietly.function';
import { CPUtilities, FsUtilities } from '../../encapsulation';
import { Path } from '../../utilities';

/**
 * Removing a feature from a project generated with it: what the project never
 * changed goes, what it changed stays, and the feature's lines are merged out of the shared files.
 */

const PREFERENCES_PAGE: string = 'src/templates/pages/mailing-list-preferences.tsx';

let workDir: Path;
let project: GeneratedProject;
let execSpy: jest.SpiedFunction<typeof CPUtilities.exec>;

/**
 * Runs `zi remove` in the project.
 * @param features - The features, as the command line names them.
 */
async function remove(features: string): Promise<void> {
    await quietly(async () => new RemoveCommand().start(['r', features]));
}

describe('RemoveCommand', () => {

    beforeEach(async () => {
        process.env['GIT_CONFIG_GLOBAL'] = '/dev/null';
        process.env['GIT_CONFIG_NOSYSTEM'] = '1';
        workDir = await emptyWorkDirectory('remove-command');
        execSpy = jest.spyOn(CPUtilities, 'exec').mockResolvedValue(undefined);
        project = await GeneratedProject.create(workDir, ['none', 'isLoggedIn', EVERY_FEATURE]);
        execSpy.mockClear();
    });

    afterEach(async () => {
        CPUtilities['cwd'] = undefined;
        delete process.env['GIT_CONFIG_GLOBAL'];
        delete process.env['GIT_CONFIG_NOSYSTEM'];
        jest.restoreAllMocks();
        await FsUtilities.rm(workDir);
    });

    it('deletes the files of the feature the project never changed, and keeps the ones it did', async () => {
        const changed: string = `// reworded by the product team\n${await project.read(PREFERENCES_PAGE)}`;
        await project.write(PREFERENCES_PAGE, changed);
        project.commitAll('rewords the preferences');

        await remove('mailingList');

        expect(await project.exists('src/templates/pages/subscribe-success.tsx')).toBe(false);
        expect(await project.exists('src/templates/emails/mailing-list-subscribe-confirmation.tsx')).toBe(false);
        expect(await project.read(PREFERENCES_PAGE)).toBe(changed);
        expect((await project.resolveManifest()).answers.features).toEqual(['pages', 'docs', 'metricsDashboard', 'logEmail']);
    });

    it('takes the lines of the feature out of the files it shares with the project', async () => {
        await remove('mailingList');

        const options: string = await project.read('src/application-options.base.ts');
        expect(options).toContain('    plugins: [],');
        expect(options).not.toContain('MailingList');
        expect(await project.read('src/providers.ts')).not.toContain('MAILING_LIST');
        expect(await project.read('src/data-sources/db/entities.ts')).not.toContain('MailingList');
    });

    it('uninstalls what only the feature needs', async () => {
        await remove('metricsDashboard');

        expect(execSpy.mock.calls.map(([command]) => command)).toEqual([`cd "${project.appDir}" && npm uninstall chart.js`]);
    });

    it('refuses to remove a feature another one is built on, before changing anything', async () => {
        mockExitGracefully();

        await expect(remove('pages')).rejects.toThrow(ProcessExitError);
        expect(execSpy).not.toHaveBeenCalled();
        expect(project.git('status', '--porcelain')).toBe('');
    });
});