import { describe, expect, it } from '@jest/globals';

import { acceptedSandboxDifferences } from './accepted-sandbox-differences';
import recordedSandboxDiffs from './recorded-sandbox-diffs.json';

/**
 * The diffs the sandbox parity test recorded during its last run, keyed by the file's path
 * relative to the generated app root. The heavy test rewrites this file on every run.
 */
const recordedDifferences: Record<string, string> = recordedSandboxDiffs;

/**
 * Guards acceptedSandboxDifferences against the mistake it invites: its entries have to be the
 * byte-exact output of diffFileContents(), but the obvious way to fill them - copying a diff out
 * of a failing test report - silently drops trailing whitespace and turns newlines into line
 * breaks the terminal chose. Checking the entries against the recorded run catches that in
 * milliseconds instead of after the several minutes the heavy test spends on "npm install".
 */
describe('acceptedSandboxDifferences', () => {
    it.each(Object.keys(recordedDifferences))('holds the exact recorded diff for %s', relativePath => {
        expect(acceptedSandboxDifferences[relativePath]).toBe(recordedDifferences[relativePath]);
    });

    it('does not accept differences for files that actually match', () => {
        const acceptedButNotDiffering: string[] = Object.keys(acceptedSandboxDifferences)
            .filter((relativePath: string) => recordedDifferences[relativePath] == undefined);

        expect(acceptedButNotDiffering).toEqual([]);
    });
});