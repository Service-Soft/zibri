import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { acceptedSandboxDifferences } from './accepted-sandbox-differences.ts';
import { SANDBOX_DIR } from './generated-file-paths.ts';

describe('acceptedSandboxDifferences', () => {
    it('describes only files the sandbox still has', () => {
        const missing: string[] = Object.keys(acceptedSandboxDifferences)
            .filter(p => !existsSync(path.join(SANDBOX_DIR, p)));

        // an entry outlives the file it was written for silently: the parity check only consults
        // this list for paths it is comparing, so a stale entry is never read and never fails. What
        // it does do is sit there looking reviewed, so the next person to see that path diverge
        // finds an entry already permitting it
        expect(missing).toEqual([]);
    });

    it('says something for every path it lists', () => {
        const empty: string[] = Object.entries(acceptedSandboxDifferences)
            .filter(([, diff]) => diff.trim() === '')
            .map(([p]) => p);

        // an entry has to be the diff it accepts, so an empty one accepts anything that path does -
        // which is the whole list's purpose inverted
        expect(empty).toEqual([]);
    });
});