import { describe, expect, it } from '@jest/globals';

import { CPUtilities, ProcessResult } from './cp.utilities';
import { FsUtilities } from './fs.utilities';
import { emptyWorkDirectory } from '../__testing__/empty-work-directory.function';
import { getPath, Path } from '../utilities';

describe('CPUtilities.resolveResult', () => {
    // npm's programs are scripts on windows rather than executables, and `zi upgrade` runs npx to
    // generate what an earlier release did
    it('runs one of npm\'s programs, with an argument holding a space as one argument', async () => {
        const workDir: Path = await emptyWorkDirectory('cp-utilities');
        const prefix: Path = getPath(workDir, 'a folder');
        await FsUtilities.mkdir(prefix);
        try {
            const result: ProcessResult = CPUtilities.resolveResult('npm', ['prefix', '--prefix', prefix], workDir);

            // together, so a failure shows what npm said about it
            expect({ status: result.status, stderr: result.stderr.toString() }).toMatchObject({ status: 0 });
            expect(result.stdout.toString().trim()).toBe(prefix);
        }
        finally {
            await FsUtilities.rm(workDir);
        }
    });
});