/* eslint-disable jsdoc/require-jsdoc */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const published = ['tsx', 'zibri', 'testing', 'cli'];

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
export function declaredVersions() {
    const result = {};
    for (const dir of published) {
        const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'packages', dir, 'package.json'), 'utf8'));
        result[manifest.name] = manifest.version;
    }
    return result;
}

function main() {
    process.stdout.write(`version=${releaseVersion(declaredVersions())}\n`);
}

// argv[1] is undefined when this module is imported by a `--eval` script rather than run
if (process.argv[1] != undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}