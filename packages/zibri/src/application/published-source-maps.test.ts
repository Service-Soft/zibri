import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { NpmPackUtilities, PackedTarball } from '../__testing__/npm-pack.utilities';
import { JsonUtilities } from '../utilities/json.utilities';
import { Ms } from '../utilities/ms';

// a map naming a source the tarball leaves out is a warning in every build that reads it, per file: webpack's
// source map loader printed one for each file of zibri-contract, whose maps led into a `src` it did not ship

const packagesDir: string = path.resolve(__dirname, '..', '..', '..');
const cdWorkflow: string = path.join(packagesDir, '..', '.github', 'workflows', 'cd.yml');

/**
 * What a source map names of the files it was made from.
 */
type SourceMap = {
    /**
     * The files, relative to the map and its `sourceRoot`.
     */
    sources: string[],
    /**
     * What the sources are relative to, beside the map.
     */
    sourceRoot?: string
};

/**
 * The folder of each package the release publishes, by its name.
 * @returns The folders.
 */
function resolvePublishedPackages(): [string, string][] {
    const published: Set<string> = new Set([...readFileSync(cdWorkflow, 'utf8').matchAll(/npm publish -w (\S+)/g)].map(match => match[1] ?? ''));
    return readdirSync(packagesDir)
        .filter(folder => existsSync(path.join(packagesDir, folder, 'package.json')))
        .map((folder): [string, string] => [
            JsonUtilities.parse<{ name: string }>(readFileSync(path.join(packagesDir, folder, 'package.json'), 'utf8')).name,
            path.join(packagesDir, folder)
        ])
        .filter(([name]) => published.has(name));
}

describe('the source maps of each published package', () => {
    const packages: [string, string][] = resolvePublishedPackages();

    it('are read from every package the release publishes', () => {
        // a guard on the reading: a workflow this stops understanding would leave nothing to check
        expect(packages.map(([name]) => name).sort()).toEqual(
            ['zibri', 'zibri-cli', 'zibri-contract', 'zibri-mdx', 'zibri-testing', 'zibri-tsx', 'zibri-tsx-compiler']
        );
    });

    it.each(packages)('of %s name only sources the tarball ships', (name, packageDir) => {
        // the maps are what the build writes, so without one there is nothing to check
        expect([name, existsSync(path.join(packageDir, 'dist'))]).toEqual([name, true]);
        const tarball: PackedTarball = NpmPackUtilities.resolveTarball(packageDir);
        const shipped: Set<string> = new Set(tarball.files);

        const missing: string[] = [];
        for (const mapFile of tarball.files.filter(file => file.endsWith('.map'))) {
            const map: SourceMap = JsonUtilities.parse(readFileSync(path.join(packageDir, mapFile), 'utf8'));
            for (const source of map.sources) {
                const resolved: string = path.posix.normalize(path.posix.join(path.posix.dirname(mapFile), map.sourceRoot ?? '', source));
                if (!shipped.has(resolved)) {
                    missing.push(`${mapFile}: ${resolved}`);
                }
            }
        }
        // a few of them, rather than every map of a package that ships no sources
        expect(missing.slice(0, 5)).toEqual([]);
    }, 2 * Ms.MINUTE);
});
