import { describe, expect, it } from 'vitest';

import { SemVerUtilities } from './sem-ver.utilities.ts';
import { zibriVersion } from './zibri-version.function.ts';
import { FsUtilities } from '../utilities/fs.utilities.ts';
import { JsonUtilities } from '../utilities/json.utilities.ts';

describe('zibriVersion', () => {
    it('reads the version off the package that is running', () => {
        const { version } = JsonUtilities.parse<{ version: string }>(
            FsUtilities.readFileSync(FsUtilities.getPath(import.meta.dirname, '..', '..', 'package.json'))
        );

        // not just "some semver": the one npm publishes, since a version read from anywhere else is
        // a second place a version is written
        expect(zibriVersion()).toBe(version);
        expect(SemVerUtilities.isSemVerVersion(zibriVersion())).toBe(true);
    });

    it('answers the same thing every time it is asked', () => {
        // read once and kept, because it cannot change while the process runs - and a backup asks
        // for it on every write
        expect(zibriVersion()).toBe(zibriVersion());
    });
});