/* eslint-disable jsdoc-js/require-jsdoc */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const published = ['tsx', 'zibri', 'testing', 'cli'];
export const dependencyFields = ['dependencies', 'devDependencies', 'peerDependencies'];

// this needs to be exported, as its manually string imported into the ci-workflows.test.ts
export function releaseVersion(versions) {
    const distinct = [...new Set(Object.values(versions))];
    if (distinct.length !== 1) {
        const listed = Object.entries(versions)
            .map(([name, version]) => `${name}@${version}`)
            .join(', ');
        throw new Error(`the packages of one release declare different versions: ${listed}`);
    }
    return distinct[0];
}

// this needs to be exported, as its manually string imported into the ci-workflows.test.ts
export function declaredManifests() {
    const result = {};
    for (const dir of published) {
        const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'packages', dir, 'package.json'), 'utf8'));
        result[manifest.name] = manifest;
    }
    return result;
}

// this needs to be exported, as its manually string imported into the ci-workflows.test.ts
export function declaredVersions(manifests = declaredManifests()) {
    return Object.fromEntries(Object.entries(manifests).map(([name, manifest]) => [name, manifest.version]));
}

// The packages name each other - zibri peer depends on zibri-tsx, zibri-testing on zibri - and are
// released together, so a range between them names the release it ships in. A range a bump left
// behind is a published package refusing the one released beside it, which the version check above
// cannot see: every version agrees, and the ranges still point at the previous major.
// this needs to be exported, as its manually string imported into the ci-workflows.test.ts
export function validateInternalRanges(manifests, version) {
    const names = new Set(Object.keys(manifests));
    const wrong = [];
    for (const [name, manifest] of Object.entries(manifests)) {
        for (const field of dependencyFields) {
            for (const [dependency, range] of Object.entries(manifest[field] ?? {})) {
                if (names.has(dependency) && range !== `^${version}`) {
                    wrong.push(`${name} ${field}.${dependency}@${range}`);
                }
            }
        }
    }
    if (wrong.length > 0) {
        throw new Error(`the packages of release ${version} have to name each other at ^${version}: ${wrong.join(', ')}`);
    }
}

function parseVersion(version) {
    return version.split('-')[0].split('.').map(Number);
}

function compareVersions(a, b) {
    const left = parseVersion(a);
    const right = parseVersion(b);
    const differing = left.findIndex((part, index) => part !== right[index]);
    return differing === -1 ? 0 : left[differing] - right[differing];
}

// npm tags every publish `latest` unless told otherwise, and npm 11 refuses to when a higher version
// exists - so without this a fix for an older major could not be released at all. Only the latest
// major is maintained today; this is what keeps maintaining another one a branch rather than a
// change to the release: a `release-<major>` branch publishes under `latest-<major>`, the tag npm uses
// for its own old lines.
// this needs to be exported, as its manually string imported into the ci-workflows.test.ts
export function resolveDistTag(version, publishedVersions) {
    // npm itself refuses a prerelease without a tag, and `latest` would hand it to every install
    if (version.includes('-')) {
        return 'next';
    }
    const [major] = parseVersion(version);
    const newer = publishedVersions.filter(other => !other.includes('-') && compareVersions(other, version) > 0);
    if (newer.length === 0) {
        return 'latest';
    }
    const newerInMajor = newer.filter(other => parseVersion(other)[0] === major);
    if (newerInMajor.length > 0) {
        // `latest-<major>` would point back at a version its own line has moved past
        const listed = newerInMajor.join(', ');
        throw new Error(`${version} is below ${listed}, already released in major ${major} - release a version above them`);
    }
    return `latest-${major}`;
}

// the four are released in lockstep, so zibri's versions are the release's versions
function findPublishedVersions() {
    try {
        const versions = JSON.parse(execFileSync('npm', ['view', 'zibri', 'versions', '--json'], { encoding: 'utf8' }));
        // npm prints a lone version as a string rather than a list of one
        return Array.isArray(versions) ? versions : [versions];
    }
    catch (error) {
        if (String(error.stdout).includes('E404')) {
            return [];
        }
        throw error;
    }
}

function main() {
    const manifests = declaredManifests();
    const version = releaseVersion(declaredVersions(manifests));
    validateInternalRanges(manifests, version);
    process.stdout.write(`version=${version}\n`);
    process.stdout.write(`dist_tag=${resolveDistTag(version, findPublishedVersions())}\n`);
}

// argv[1] is undefined when this module is imported by a `--eval` script rather than run
if (process.argv[1] != undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}