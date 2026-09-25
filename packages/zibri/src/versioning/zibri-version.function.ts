import { SemVerUtilities, SemVerVersion } from './sem-ver.utilities';
import { InternalError } from '../error-handling/internal-error.model';
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { JsonUtilities } from '../utilities/json.utilities';
import { resolveZibriRoot } from '../utilities/resolve-zibri-root.function';

/**
 * Read once, because it cannot change while the process runs.
 */
let cached: SemVerVersion | undefined;

/**
 * Which version of the framework is running.
 *
 * Read off the package rather than generated into the build, so there is one place a version is
 * written and it is the one npm publishes.
 *
 * This is the framework's version, which `GlobalRegistry.getAppData('version')` is not - that one is
 * the application's, and the two move independently.
 * @returns The version of the zibri package this process loaded.
 * @throws {InternalError} When the package declares no version that can be read.
 */
export function zibriVersion(): SemVerVersion {
    if (cached != undefined) {
        return cached;
    }

    const p: FsPath = FsUtilities.getPath(resolveZibriRoot(), 'package.json');
    // eslint-disable-next-line jsdoc/require-jsdoc
    const { version } = JsonUtilities.parse<{ version: string }>(FsUtilities.readFileSync(p));
    if (!SemVerUtilities.isSemVerVersion(version)) {
        throw new InternalError(`The zibri package at "${p}" declares no readable version.`);
    }

    cached = version;
    return cached;
}