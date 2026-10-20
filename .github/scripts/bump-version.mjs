/* eslint-disable jsdoc-js/require-jsdoc */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { dependencyFields, published, repoRoot } from './release-version.mjs';

// The manifests and the lockfile are rewritten together: the lockfile carries each workspace's
// version and ranges as well, and `npm ci` refuses one that disagrees with the manifests - so a bump
// that edits only the manifests is a release whose first step fails.

// the files are written the way npm writes them, four spaces, and a trailing newline where there was one
function writeJsonLike(original, value) {
    return `${JSON.stringify(value, undefined, 4)}${original.endsWith('\n') ? '\n' : ''}`;
}

// this needs to be exported, as its manually string imported into the ci-workflows.test.ts
export function bumpEntry(entry, version, releasedNames) {
    const result = { ...entry, version };
    for (const field of dependencyFields) {
        if (entry[field] == undefined) {
            continue;
        }
        result[field] = Object.fromEntries(
            Object.entries(entry[field]).map(([name, range]) => [name, releasedNames.has(name) ? `^${version}` : range])
        );
    }
    return result;
}

// this needs to be exported, as its manually string imported into the ci-workflows.test.ts
export function bumpManifest(text, version, releasedNames) {
    return writeJsonLike(text, bumpEntry(JSON.parse(text), version, releasedNames));
}

// this needs to be exported, as its manually string imported into the ci-workflows.test.ts
export function bumpLockfile(text, version, releasedNames) {
    const lockfile = JSON.parse(text);
    for (const dir of published) {
        const key = `packages/${dir}`;
        if (lockfile.packages[key] == undefined) {
            throw new Error(`package-lock.json has no entry for ${key} - run npm install first`);
        }
        lockfile.packages[key] = bumpEntry(lockfile.packages[key], version, releasedNames);
    }
    return writeJsonLike(text, lockfile);
}

// the section the release notes go into, on top, since the newest release is what a reader wants
// first. Left empty on purpose: the release refuses an empty one, which is what makes it get written
// this needs to be exported, as its manually string imported into the ci-workflows.test.ts
export function addChangelogSection(changelog, version) {
    const lines = changelog.split('\n');
    if (lines.some(line => line.trim() === `## ${version}`)) {
        return changelog;
    }
    const firstSection = lines.findIndex(line => line.startsWith('## '));
    if (firstSection === -1) {
        return `${changelog.trimEnd()}\n\n## ${version}\n`;
    }
    lines.splice(firstSection, 0, `## ${version}`, '');
    return lines.join('\n');
}

function main() {
    const version = process.argv[2];
    if (version == undefined || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
        throw new Error('usage: npm run release:bump -- <major.minor.patch>');
    }
    const manifestPaths = published.map(dir => path.join(repoRoot, 'packages', dir, 'package.json'));
    const releasedNames = new Set(manifestPaths.map(manifestPath => JSON.parse(readFileSync(manifestPath, 'utf8')).name));

    for (const manifestPath of manifestPaths) {
        writeFileSync(manifestPath, bumpManifest(readFileSync(manifestPath, 'utf8'), version, releasedNames));
    }
    const lockfilePath = path.join(repoRoot, 'package-lock.json');
    writeFileSync(lockfilePath, bumpLockfile(readFileSync(lockfilePath, 'utf8'), version, releasedNames));
    const changelogPath = path.join(repoRoot, 'CHANGELOG.md');
    writeFileSync(changelogPath, addChangelogSection(readFileSync(changelogPath, 'utf8'), version));
}

// argv[1] is undefined when this module is imported by a `--eval` script rather than run
if (process.argv[1] != undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}