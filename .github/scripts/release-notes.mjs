/* eslint-disable jsdoc/require-jsdoc */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { repoRoot } from './release-version.mjs';

// The notes are written by a person, and the release refuses to go out without them - the same shape
// as the version check: what cannot be generated is at least impossible to forget. A section is the
// lines under `## <version>` up to the next `## `, so the newest release goes on top.
// this needs to be exported, as its manually string imported into the ci-workflows.test.ts
export function resolveReleaseNotes(changelog, version) {
    const lines = changelog.split('\n');
    const start = lines.findIndex(line => line.trim() === `## ${version}`);
    if (start === -1) {
        throw new Error(`CHANGELOG.md has no section "## ${version}" - write down what this release changes`);
    }
    const end = lines.findIndex((line, index) => index > start && line.startsWith('## '));
    const notes = lines
        .slice(start + 1, end === -1 ? undefined : end)
        .join('\n')
        .trim();
    if (notes === '') {
        throw new Error(`the section "## ${version}" in CHANGELOG.md is empty - write down what this release changes`);
    }
    return notes;
}

function main() {
    const version = process.argv[2];
    if (version == undefined) {
        throw new Error('usage: node release-notes.mjs <version>');
    }
    const changelog = readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');
    process.stdout.write(`${resolveReleaseNotes(changelog, version)}\n`);
}

// argv[1] is undefined when this module is imported by a `--eval` script rather than run
if (process.argv[1] != undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}