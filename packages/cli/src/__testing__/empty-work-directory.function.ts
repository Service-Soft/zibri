import { testFileFolder } from './constants';
import { FsUtilities } from '../encapsulation';
import { getPath, Path } from '../utilities';

/**
 * An empty directory for a suite to generate into, whatever the run before it left behind.
 *
 * Creating it is not enough, because `zi new` refuses a directory that already exists - so a run that
 * was interrupted while a project stood there makes every later run fail, reporting the leftover
 * rather than anything about the generator. The suites this matters most to are the ones that take
 * minutes, which are exactly the ones somebody stops halfway.
 *
 * It goes wrong quietly, too: the refusal ends in `exitGracefully`, which never settles under a test
 * runner, so a suite whose directory was dirty spends its whole timeout saying nothing.
 * @param name - The directory's name under the test output folder, unique to one suite.
 * @returns Its path.
 */
export async function emptyWorkDirectory(name: string): Promise<Path> {
    const workDir: Path = getPath(testFileFolder, name);
    await FsUtilities.rm(workDir);
    await FsUtilities.mkdir(workDir);
    return workDir;
}