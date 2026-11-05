import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { GenerateCommand } from './generate.command';
import { emptyWorkDirectory } from '../../__testing__/empty-work-directory.function';
import { EVERY_FEATURE } from '../../__testing__/generated-file-paths';
import { mockExitGracefully, ProcessExitError } from '../../__testing__/mock-exit-gracefully.function';
import { quietly } from '../../__testing__/quietly.function';
import { CPUtilities, FsUtilities } from '../../encapsulation';
import { ScaffoldUtilities } from '../../scaffold';
import { Path } from '../../utilities';
import { NewCommand } from '../new/new.command';

describe('GenerateCommand', () => {
    let workDir: Path;
    let execSpy: jest.SpiedFunction<typeof CPUtilities.exec>;

    beforeEach(async () => {
        workDir = await emptyWorkDirectory('generate-command');
        CPUtilities['cwd'] = workDir;
        execSpy = jest.spyOn(CPUtilities, 'exec').mockResolvedValue(undefined);
    });

    afterEach(async () => {
        CPUtilities['cwd'] = undefined;
        jest.restoreAllMocks();
        await FsUtilities.rm(workDir);
    });

    it('writes every file "zi new" generates from the same answers, and installs nothing', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'github', 'public', EVERY_FEATURE]));
        execSpy.mockClear();
        const folder: Path = path.join(workDir, 'generated') as Path;

        await quietly(async () => new GenerateCommand().start(['g', folder, 'api', 'github', 'public', EVERY_FEATURE]));

        const generated: Map<string, Buffer> = await ScaffoldUtilities.resolveGeneratedFiles(folder);
        expect(generated).toEqual(await ScaffoldUtilities.resolveGeneratedFiles(path.join(workDir, 'api') as Path));
        expect(execSpy).not.toHaveBeenCalled();
    });

    it('generates a project without features from "none"', async () => {
        const folder: Path = path.join(workDir, 'generated') as Path;

        await quietly(async () => new GenerateCommand().start(['g', folder, 'api', 'none', 'isLoggedIn', 'none']));

        expect([...(await ScaffoldUtilities.resolveGeneratedFiles(folder)).keys()]).not.toContain('src/controllers/page.controller.ts');
    });

    it('refuses a command line that leaves an answer out, as nobody is there to ask', async () => {
        mockExitGracefully();

        await expect(quietly(async () => new GenerateCommand().start(['g', path.join(workDir, 'generated'), 'api', 'none', 'isLoggedIn'])))
            .rejects.toThrow(ProcessExitError);
        expect(await FsUtilities.exists(path.join(workDir, 'generated') as Path)).toBe(false);
    });
});