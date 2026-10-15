/* eslint-disable jsdoc/require-jsdoc */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { published, repoRoot } from './release-version.mjs';

const advisoriesUrl = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk';
const failingSeverities = new Set(['high', 'critical']);
// a package names what it installs under these, and a consumer gets all three: npm installs peers
// since npm 7, and an optional dependency whenever its platform matches
const installedFields = ['dependencies', 'peerDependencies', 'optionalDependencies'];

function namesInstalledBy(entry) {
    return [...new Set(installedFields.flatMap(field => Object.keys(entry?.[field] ?? {})))];
}

// node's own lookup: the nearest node_modules on the way up from the package asking for it
function resolveInstalledPath(entries, from, name) {
    let base = from;
    for (;;) {
        const candidate = `${base}/node_modules/${name}`;
        if (entries[candidate] != undefined) {
            return candidate;
        }
        const nested = base.lastIndexOf('/node_modules/');
        if (nested !== -1) {
            base = base.slice(0, nested);
            continue;
        }
        return entries[`node_modules/${name}`] == undefined ? undefined : `node_modules/${name}`;
    }
}

// What a consumer can end up installing, read off the lockfile: the published packages' dependencies
// and peers, and everything those pull in. Not the lockfile's own `dev` flag - an optional peer such
// as re2 is a devDependency here, so the repository's tree calls it dev, while a consumer using a
// declared regex installs it and everything behind it. And not the private workspaces, which nobody
// installs.
// this needs to be exported, as its manually string imported into the ci-workflows.test.ts
export function resolveConsumerTree(lock, publishedDirs = published) {
    const entries = lock.packages;
    const found = new Map();
    const pending = publishedDirs.map(dir => `packages/${dir}`);
    while (pending.length > 0) {
        const from = pending.pop();
        for (const name of namesInstalledBy(entries[from])) {
            const at = resolveInstalledPath(entries, from, name);
            // a peer nobody installed is one a consumer is not handed either, and a link is one of the
            // published packages themselves, which the walk starts from anyway
            if (at == undefined || found.has(at) || entries[at].link === true) {
                continue;
            }
            found.set(at, { name, version: entries[at].version, license: entries[at].license, path: at });
            pending.push(at);
        }
    }
    return [...found.values()];
}

// The license a manifest declares, as one SPDX expression. Besides the `license` string, the two
// shapes npm has since deprecated: a `{ type }` object, and a `licenses` list of them. What several
// entries in that list mean was never defined - a choice or a combination - so they are read as a
// combination, which is the reading that cannot let a package through on a license it does not offer.
// this needs to be exported, as its manually string imported into the ci-workflows.test.ts
export function resolveManifestLicense(manifest) {
    const declared = manifest.license ?? manifest.licenses;
    if (typeof declared === 'string') {
        return declared;
    }
    const types = (Array.isArray(declared) ? declared : [declared])
        .map(entry => entry?.type)
        .filter(type => typeof type === 'string');
    if (types.length === 0) {
        return undefined;
    }
    return types.length === 1 ? types[0] : `(${types.join(' AND ')})`;
}

// The tree with the license of every package the lockfile left without one filled in from its
// installed manifest. The lockfile records `license` only when it is a string, so a package declaring
// it the deprecated way arrives here as having none. A package that is not installed - an optional one
// for another platform - keeps what the lockfile said.
// this needs to be exported, as its manually string imported into the ci-workflows.test.ts
export function resolveDeclaredLicenses(tree, readManifest) {
    return tree.map(entry => {
        if (entry.license != undefined) {
            return entry;
        }
        const manifest = readManifest(entry.path);
        return manifest == undefined ? entry : { ...entry, license: resolveManifestLicense(manifest) };
    });
}

// An SPDX expression, read the way the standard does: OR binds looser than AND, and parentheses group.
// Anything else - a WITH exception, a url, a license named in prose - is not allowed, because what it
// permits is not something a list of identifiers can answer.
// this needs to be exported, as its manually string imported into the ci-workflows.test.ts
export function isLicenseAllowed(expression, allowed) {
    if (typeof expression !== 'string') {
        return false;
    }
    const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
    // methods rather than separate functions, since a parenthesis takes the reader back to the top
    const reader = {
        position: 0,
        readOr() {
            let result = this.readAnd();
            while (tokens[this.position] === 'OR') {
                this.position++;
                result = this.readAnd() || result;
            }
            return result;
        },
        readAnd() {
            let result = this.readTerm();
            while (tokens[this.position] === 'AND') {
                this.position++;
                result = this.readTerm() && result;
            }
            return result;
        },
        readTerm() {
            const token = tokens[this.position++];
            if (token === '(') {
                const inner = this.readOr();
                return tokens[this.position++] === ')' && inner;
            }
            return token != undefined && token !== ')' && token !== 'AND' && token !== 'OR' && allowed.includes(token);
        }
    };
    return reader.readOr() && reader.position === tokens.length;
}

// The packages whose license the policy does not allow, as `name@version (license)`. An exception is
// for one version, because what was checked by hand is that version's license - an upgrade that
// changed it would otherwise go through on the strength of the old one.
// this needs to be exported, as its manually string imported into the ci-workflows.test.ts
export function findLicenseViolations(tree, policy) {
    return tree
        .filter(({ name, version, license }) => !isLicenseAllowed(
            policy.exceptions[`${name}@${version}`]?.license ?? license,
            policy.allowed
        ))
        .map(({ name, version, license }) => `${name}@${version} (${license ?? 'no license declared'})`);
}

// what the advisory endpoint answered, narrowed to the severities that fail the check
// this needs to be exported, as its manually string imported into the ci-workflows.test.ts
export function findFailingAdvisories(advisoriesByName) {
    return Object.entries(advisoriesByName).flatMap(([name, advisories]) => advisories
        .filter(advisory => failingSeverities.has(advisory.severity))
        .map(advisory => `${name} ${advisory.vulnerable_versions}: ${advisory.severity} - ${advisory.title} (${advisory.url})`));
}

// the endpoint npm audit itself asks, which answers only the advisories that affect the versions named
async function resolveAdvisories(tree) {
    const versionsByName = {};
    for (const { name, version } of tree) {
        versionsByName[name] = [...new Set([...versionsByName[name] ?? [], version])];
    }
    const response = await fetch(advisoriesUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(versionsByName)
    });
    if (!response.ok) {
        throw new Error(`${advisoriesUrl} answered ${response.status}`);
    }
    return await response.json();
}

function readJson(...segments) {
    return JSON.parse(readFileSync(path.join(repoRoot, ...segments), 'utf8'));
}

// this needs to be exported, as its manually string imported into the ci-workflows.test.ts
export function readInstalledManifest(packagePath) {
    const manifestPath = path.join(repoRoot, packagePath, 'package.json');
    return existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : undefined;
}

async function main() {
    const tree = resolveDeclaredLicenses(resolveConsumerTree(readJson('package-lock.json')), readInstalledManifest);
    const licenses = findLicenseViolations(tree, readJson('.github', 'license-policy.json'));
    const advisories = findFailingAdvisories(await resolveAdvisories(tree));
    process.stdout.write(`checked the ${tree.length} packages a consumer can install\n`);
    for (const line of licenses) {
        process.stdout.write(`license not allowed: ${line}\n`);
    }
    for (const line of advisories) {
        process.stdout.write(`advisory: ${line}\n`);
    }
    if (licenses.length > 0 || advisories.length > 0) {
        process.exitCode = 1;
    }
}

// argv[1] is undefined when this module is imported by a `--eval` script rather than run
if (process.argv[1] != undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}