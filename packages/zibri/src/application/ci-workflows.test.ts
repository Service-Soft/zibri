import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from '@jest/globals';

import { JsonUtilities } from '../utilities/json.utilities';

/**
 * What CI runs, checked against what the packages promise.
 *
 * A workflow file is the one part of the repository that nothing else can contradict: it is not
 * imported, not compiled and not linted, so a version it names drifts away from `engines` silently
 * and the only symptom is a runtime the framework claims to support and has never once executed.
 * That had already happened here - `engines` said `>=22` while CI ran 22 and nothing else.
 *
 * The matrix is derived from node's release schedule rather than written down, so most of what is
 * asserted below is that the derivation is still in place. The one thing worth testing directly is
 * the derivation itself, which is why it lives in a module of its own instead of inside a `run:`.
 */

const repoRoot: string = path.resolve(__dirname, '..', '..', '..', '..');
const packagesDir: string = path.join(repoRoot, 'packages');
const workflowsDir: string = path.join(repoRoot, '.github', 'workflows');
const resolverPath: string = path.join(repoRoot, '.github', 'scripts', 'supported-node-majors.mjs');
const releaseVersionPath: string = path.join(repoRoot, '.github', 'scripts', 'release-version.mjs');
const releaseNotesPath: string = path.join(repoRoot, '.github', 'scripts', 'release-notes.mjs');
const bumpVersionPath: string = path.join(repoRoot, '.github', 'scripts', 'bump-version.mjs');
const consumerTreePath: string = path.join(repoRoot, '.github', 'scripts', 'check-consumer-tree.mjs');

/**
 * Reads one of the repository's workflow definitions.
 * @param name - The file name inside `.github/workflows`.
 * @returns The file's contents.
 */
function workflow(name: string): string {
    return readFileSync(path.join(workflowsDir, name), 'utf8');
}

/**
 * Every node major a workflow names outright, as opposed to resolving.
 * @param content - A workflow definition.
 * @returns The majors, ascending.
 */
function literalNodeMajorsIn(content: string): number[] {
    const found: number[] = [...content.matchAll(/node-version: *'(\d+)/g)].map(m => Number(m[1]));
    return [...new Set(found)].sort((a, b) => a - b);
}

/**
 * The lowest node version each published package declares it runs on.
 * @returns The floor major, by package directory name.
 */
function declaredNodeFloors(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const dir of readdirSync(packagesDir, { withFileTypes: true })) {
        const manifestPath: string = path.join(packagesDir, dir.name, 'package.json');
        if (!dir.isDirectory() || !existsSync(manifestPath)) {
            continue;
        }
        const manifest: { engines?: { node?: string } } = JsonUtilities.parse(
            readFileSync(manifestPath, 'utf8')
        );
        const range: string | undefined = manifest.engines?.node;
        if (range == undefined) {
            continue;
        }
        result[dir.name] = Number(/>=\s*(\d+)/.exec(range)?.[1]);
    }
    return result;
}

/**
 * The parts of a workspace's `package.json` the manifest checks read.
 */
type WorkspaceManifest = {
    /**
     * The name the package goes out under.
     */
    name: string,
    /**
     * What it needs at runtime.
     */
    dependencies?: Record<string, string>,
    /**
     * What it is built, linted and tested with.
     */
    devDependencies?: Record<string, string>,
    /**
     * What a consumer brings.
     */
    peerDependencies?: Record<string, string>
};

/**
 * Every workspace's manifest.
 * @returns The manifests, by package directory name.
 */
function workspaceManifests(): Record<string, WorkspaceManifest> {
    const result: Record<string, WorkspaceManifest> = {};
    for (const dir of readdirSync(packagesDir, { withFileTypes: true })) {
        const manifestPath: string = path.join(packagesDir, dir.name, 'package.json');
        if (dir.isDirectory() && existsSync(manifestPath)) {
            result[dir.name] = JsonUtilities.parse(readFileSync(manifestPath, 'utf8'));
        }
    }
    return result;
}

/**
 * The lowest version a range accepts, as `[major, minor, patch]`.
 * @param range - A range as a manifest writes it, such as `^5.9.2` or `>=24`.
 * @returns The lower bound, with missing parts as 0.
 */
function lowerBoundOf(range: string): [number, number, number] {
    const match: RegExpExecArray | null = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(range);
    return [Number(match?.[1] ?? 0), Number(match?.[2] ?? 0), Number(match?.[3] ?? 0)];
}

/**
 * Whether one version is at least another.
 * @param version - The version being checked.
 * @param floor - What it has to reach.
 * @returns True when `version` is the same as or later than `floor`.
 */
function isAtLeast(version: [number, number, number], floor: [number, number, number]): boolean {
    const [major, minor, patch]: [number, number, number] = version;
    const [floorMajor, floorMinor, floorPatch]: [number, number, number] = floor;
    if (major !== floorMajor) {
        return major > floorMajor;
    }
    if (minor !== floorMinor) {
        return minor > floorMinor;
    }
    return patch >= floorPatch;
}

/**
 * The part of `cd.yml` that publishes, without the docs job underneath it.
 * @returns The deploy job, as written.
 */
function deployJob(): string {
    const content: string = workflow('cd.yml');
    return content.slice(content.indexOf('    deploy:'), content.indexOf('    updateDocs:'));
}

/**
 * What the deploy job runs, in the order it runs it.
 * @returns One entry per line of the job.
 */
function deploySteps(): string[] {
    return deployJob().split('\n');
}

/**
 * Whether a line publishes for real, as opposed to rehearsing it.
 * @param line - One line of a job.
 * @returns True for a publish that reaches the registry.
 */
function isRealPublish(line: string): boolean {
    return line.includes('npm publish') && !line.includes('--dry-run');
}

/**
 * Where in a job the lines matching a predicate are.
 * @param lines - The job's lines.
 * @param matches - What to look for.
 * @returns Their indexes, ascending.
 */
function indexesMatching(lines: string[], matches: (line: string) => boolean): number[] {
    return lines.map((line, index) => matches(line) ? index : -1).filter(index => index !== -1);
}

/**
 * Runs one of the workflow's own scripts the way the workflow does, in a process of its own.
 *
 * Out of process because those scripts are es modules living outside this package - the same reason
 * `published-package.test.ts` reaches for a child. It also means what is exercised is the file CI
 * actually runs, not a copy of its logic.
 * @param script - The body of an es module to run, which must print one line of json.
 * @returns Whatever the script printed, parsed.
 */
function inResolverProcess<T>(script: string): T {
    const output: string = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
    return JsonUtilities.parse(output);
}

let publishedPackageNames: string[] | undefined;

/**
 * The packages this repository releases, by the names they go out under.
 *
 * Read out of `release-version.mjs` rather than listed here, so that the workflow and the checks on
 * it can never disagree about which packages a release is made of.
 * @returns The package names.
 */
function publishedPackages(): string[] {
    publishedPackageNames ??= inResolverProcess<{ names: string[] }>(`
        const { declaredVersions } = await import('${pathToFileURL(releaseVersionPath).href}');
        console.log(JSON.stringify({ names: Object.keys(declaredVersions()) }));
    `).names;
    return publishedPackageNames;
}

describe('the ci workflows', () => {

    it('has every package declaring the same node floor', () => {
        const floors: Record<string, number> = declaredNodeFloors();

        // one repository, one runtime. Packages that disagree cannot all be covered by one matrix,
        // and a consumer installing `zibri` and `zibri-cli` together gets the stricter of the two
        // without either of them saying so.
        expect(Object.keys(floors).length).toBeGreaterThan(0);
        expect([...new Set(Object.values(floors))]).toHaveLength(1);
    });

    it('resolves the versions it tests instead of listing them', () => {
        const content: string = workflow('ci.yml');

        // the finding this closes is not "the matrix is wrong today" - it is that a matrix written
        // down by hand goes stale the moment `engines` promises a version that did not exist when
        // somebody last edited this file.
        expect(existsSync(resolverPath)).toBe(true);
        expect(content).toContain('supported-node-majors.mjs');
        expect(content).toContain('fromJSON(needs.node-versions.outputs.majors)');
    });

    it('names no node version below the floor, anywhere', () => {
        const [floor]: number[] = Object.values(declaredNodeFloors());
        assert(floor != undefined, 'no node floor is declared anywhere');

        // the resolver and the release job still name a version outright, and either of them
        // running on something a consumer may not use would test the wrong runtime.
        for (const major of [...literalNodeMajorsIn(workflow('ci.yml')), ...literalNodeMajorsIn(workflow('cd.yml'))]) {
            expect(major).toBeGreaterThanOrEqual(floor);
        }
    });

    it('picks up a node line the week it ships, and drops one that has ended', () => {
        const schedule: Record<string, { start: string, end: string }> = {
            v22: { start: '2024-04-24', end: '2027-04-30' },
            v24: { start: '2025-05-06', end: '2028-04-30' },
            v25: { start: '2025-10-21', end: '2026-06-01' },
            v26: { start: '2026-10-20', end: '2029-04-30' }
        };
        const res: { beforeNode26: number[], afterNode26: number[] } = inResolverProcess(`
            const { maintainedMajors } = await import('${pathToFileURL(resolverPath).href}');
            const schedule = ${JsonUtilities.stringify(schedule)};
            console.log(JSON.stringify({
                beforeNode26: maintainedMajors(schedule, 24, '2026-08-28'),
                afterNode26: maintainedMajors(schedule, 24, '2026-11-01')
            }));
        `);

        // 22 is below the floor and 25 has ended - a green build on an end-of-life runtime is not
        // coverage, it is a runtime nobody may deploy reporting that it works.
        expect(res.beforeNode26).toStrictEqual([24]);
        // and this is the whole point: nothing had to be edited for 26 to be tested.
        expect(res.afterNode26).toStrictEqual([24, 26]);
    });

    it('runs on every operating system the framework is developed on', () => {
        const content: string = workflow('ci.yml');

        // the framework writes files for a living - the cli scaffolds a project, the tsx compiler
        // emits one, uploads land in a temp folder - and path semantics are where the three
        // platforms differ. Linux only leaves every one of those unproven for the developer sitting
        // in front of the other two.
        expect(content).toContain('ubuntu-latest');
        expect(content).toContain('windows-latest');
        expect(content).toContain('macos-latest');
    });

    it('gates the dependency tree it installs on a consumer\'s behalf', () => {
        // a framework that ships nine peer dependencies and pulls a transitive tree behind them
        // owns that tree's advisories on the consumer's behalf. Nothing here looked at it.
        expect(workflow('ci.yml')).toContain('node .github/scripts/check-consumer-tree.mjs');
        expect(readdirSync(workflowsDir)).toContain('codeql.yml');
        // and a pull request is held to the same policy while it can still be turned down - releases
        // included, since every release is a pull request into `release`
        expect(workflow('dependency-review.yml')).toContain('pull_request:');
        expect(workflow('dependency-review.yml')).toContain('.github/license-policy.json');
    });
});

describe('the tree a consumer installs', () => {

    /**
     * A lockfile holding one published package, one private one and the repository's own tools.
     */
    const lock: Record<string, Record<string, Record<string, unknown>>> = {
        packages: {
            'packages/zibri': { dependencies: { express: '^5.0.0' }, peerDependencies: { re2: '^1.0.0' }, devDependencies: { jest: '^30.0.0' } },
            'packages/sandbox': { dependencies: { leftpad: '^1.0.0' } },
            'node_modules/zibri': { resolved: 'packages/zibri', link: true },
            'node_modules/express': { version: '5.0.0', license: 'MIT', dependencies: { qs: '^6.0.0', zibri: '^3.0.0' } },
            'node_modules/express/node_modules/qs': { version: '6.0.0', license: 'BSD-3-Clause' },
            'node_modules/qs': { version: '5.0.0', license: 'GPL-3.0' },
            'node_modules/re2': { version: '1.27.0', license: 'BSD-3-Clause', dev: true, dependencies: { nan: '^2.0.0' } },
            'node_modules/nan': { version: '2.0.0', license: 'MIT', dev: true },
            'node_modules/jest': { version: '30.0.0', license: 'MIT', dev: true },
            'node_modules/leftpad': { version: '1.0.0', license: 'WTFPL' }
        }
    };

    it('is what the published packages install, optional peers included, and nothing only the repository uses', () => {
        const res: { tree: string[] } = inResolverProcess(`
            const { resolveConsumerTree } = await import('${pathToFileURL(consumerTreePath).href}');
            const tree = resolveConsumerTree(${JsonUtilities.stringify(lock)}, ['zibri']);
            console.log(JSON.stringify({ tree: tree.map(p => p.name + '@' + p.version).sort() }));
        `);

        // re2 is a devDependency of the repository, so its own dev flag says a consumer never gets
        // it - which is what let `npm audit --omit=dev` skip every optional peer. The copy of qs at the
        // top is not the one express resolves, and the private sandbox's packages are nobody's
        expect(res.tree).toStrictEqual(['express@5.0.0', 'nan@2.0.0', 'qs@6.0.0', 're2@1.27.0']);
    });

    it('reads a license expression the way SPDX does', () => {
        const expressions: string[] = ['MIT', '(MIT OR GPL-3.0)', 'Apache-2.0 AND MIT', 'MIT AND GPL-3.0', 'MIT WITH some-exception', 'MIT (http://example.com)'];
        const res: { allowed: boolean[] } = inResolverProcess(`
            const { isLicenseAllowed } = await import('${pathToFileURL(consumerTreePath).href}');
            const expressions = ${JsonUtilities.stringify(expressions)};
            console.log(JSON.stringify({ allowed: expressions.map(e => isLicenseAllowed(e, ['MIT', 'Apache-2.0'])) }));
        `);

        // a choice is allowed when one side is, a combination only when both are, and anything the
        // list cannot answer - an exception clause, prose - is not
        expect(res.allowed).toStrictEqual([true, true, true, false, false, false]);
    });

    it('reads a license declared in the shapes npm has deprecated', () => {
        const manifests: Record<string, unknown>[] = [
            { license: 'MIT' },
            { license: { type: 'ISC' } },
            { licenses: [{ type: 'MIT', url: 'https://example.com/LICENSE' }] },
            { licenses: [{ type: 'MIT' }, { type: 'GPL-3.0' }] },
            {}
        ];
        const res: { licenses: string[] } = inResolverProcess(`
            const { resolveManifestLicense } = await import('${pathToFileURL(consumerTreePath).href}');
            const manifests = ${JsonUtilities.stringify(manifests)};
            console.log(JSON.stringify({ licenses: manifests.map(m => resolveManifestLicense(m) ?? 'none') }));
        `);

        // the lockfile records only the string form, so ssh2 and its two helpers, which declare MIT in a
        // `licenses` list, read as unlicensed. Several entries are read as all of them applying, the
        // reading that cannot pass a package on a license it does not offer
        expect(res.licenses).toStrictEqual(['MIT', 'ISC', 'MIT', '(MIT AND GPL-3.0)', 'none']);
    });

    it('takes a license confirmed by hand for the one version it was confirmed for', () => {
        const policy: Record<string, unknown> = { allowed: ['MIT'], exceptions: { 'png-js@1.1.0': { license: 'MIT' } } };
        const tree: Record<string, string | undefined>[] = [
            { name: 'png-js', version: '1.1.0', license: undefined },
            { name: 'png-js', version: '1.2.0', license: undefined }
        ];
        const res: { violations: string[] } = inResolverProcess(`
            const { findLicenseViolations } = await import('${pathToFileURL(consumerTreePath).href}');
            console.log(JSON.stringify({ violations: findLicenseViolations(${JsonUtilities.stringify(tree)}, ${JsonUtilities.stringify(policy)}) }));
        `);

        expect(res.violations).toStrictEqual(['png-js@1.2.0 (no license declared)']);
    });

    it('fails on a high or critical advisory, and not on a lesser one', () => {
        const answered: Record<string, Record<string, string>[]> = {
            minimist: [
                { severity: 'critical', vulnerable_versions: '<0.2.4', title: 'Prototype Pollution', url: 'https://github.com/advisories/1' },
                { severity: 'moderate', vulnerable_versions: '<0.2.1', title: 'Something smaller', url: 'https://github.com/advisories/2' }
            ]
        };
        const res: { failing: string[] } = inResolverProcess(`
            const { findFailingAdvisories } = await import('${pathToFileURL(consumerTreePath).href}');
            console.log(JSON.stringify({ failing: findFailingAdvisories(${JsonUtilities.stringify(answered)}) }));
        `);

        expect(res.failing).toStrictEqual(['minimist <0.2.4: critical - Prototype Pollution (https://github.com/advisories/1)']);
    });

    it('holds every license in it to the policy', () => {
        const res: { violations: string[] } = inResolverProcess(`
            import { readFileSync } from 'node:fs';
            const { resolveConsumerTree, resolveDeclaredLicenses, readInstalledManifest, findLicenseViolations } = await import('${pathToFileURL(consumerTreePath).href}');
            const tree = resolveDeclaredLicenses(resolveConsumerTree(JSON.parse(readFileSync('package-lock.json', 'utf8'))), readInstalledManifest);
            const policy = JSON.parse(readFileSync('.github/license-policy.json', 'utf8'));
            console.log(JSON.stringify({ violations: findLicenseViolations(tree, policy) }));
        `);

        // the audit job asks the same on every push; asked here as well, a dependency added locally is
        // turned down before it is pushed
        expect(res.violations).toStrictEqual([]);
    });

    it('is checked before a release publishes anything', () => {
        const lines: string[] = deploySteps();
        const checked: number[] = indexesMatching(lines, line => line.includes('check-consumer-tree.mjs'));

        // an advisory is published against code that did not change, so the branch's last green push
        // says nothing about the moment of the release
        expect(checked).toHaveLength(1);
        expect(checked[0]).toBeLessThan(Math.min(...indexesMatching(lines, line => line.includes('npm publish'))));
    });

    it('names the licenses it allows where a reader looks for them', () => {
        const policy: { allowed: string[] } = JsonUtilities.parse(readFileSync(path.join(repoRoot, '.github', 'license-policy.json'), 'utf8'));
        const deployment: string = readFileSync(path.join(packagesDir, 'zibri', 'docs', 'deployment.md'), 'utf8');
        const section: string = deployment.slice(deployment.indexOf('## What the application is made of'), deployment.indexOf('## Running more than one instance'));

        expect(policy.allowed.filter(license => !section.includes(license))).toStrictEqual([]);
    });
});

describe('the workspace manifests', () => {

    it('names one range for a dependency that more than one workspace declares', () => {
        const manifests: WorkspaceManifest[] = Object.values(workspaceManifests());
        const workspaceNames: Set<string> = new Set(manifests.map(m => m.name));
        const rangesByName: Map<string, Set<string>> = new Map();
        for (const manifest of manifests) {
            for (const [name, range] of Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })) {
                // a workspace naming another one links to it, so its range says nothing about a version
                if (!workspaceNames.has(name)) {
                    rangesByName.set(name, (rangesByName.get(name) ?? new Set()).add(range));
                }
            }
        }
        const disagreeing: Record<string, string[]> = Object.fromEntries(
            [...rangesByName].filter(([, ranges]) => ranges.size > 1).map(([name, ranges]) => [name, [...ranges]])
        );

        // the packages are built from one lockfile and meant to interoperate, so two ranges for one
        // tool are either one copy with a range that no longer describes it, or two copies checking
        // the packages against different rules. Neither is a choice anybody made
        expect(disagreeing).toStrictEqual({});
    });

    it('types every package against the node floor it declares', () => {
        const [floor]: number[] = Object.values(declaredNodeFloors());
        assert(floor != undefined, 'no node floor is declared anywhere');
        const typedAgainst: Record<string, number> = {};
        for (const [dir, manifest] of Object.entries(workspaceManifests())) {
            const range: string | undefined = { ...manifest.dependencies, ...manifest.devDependencies }['@types/node'];
            if (range != undefined) {
                typedAgainst[dir] = lowerBoundOf(range)[0];
            }
        }

        // CI runs the floor and every newer line node still maintains, so code typed against the
        // floor runs on all of them. Typed against a newer line, an api the floor lacks compiles and
        // fails at runtime on the one version every consumer is promised
        expect(Object.keys(typedAgainst).length).toBeGreaterThan(0);
        expect(typedAgainst).toStrictEqual(Object.fromEntries(Object.keys(typedAgainst).map(dir => [dir, floor])));
    });

    it('develops each package on a version its own peer range accepts', () => {
        const outsidePeerRange: Record<string, string> = {};
        for (const [dir, manifest] of Object.entries(workspaceManifests())) {
            for (const [name, peerRange] of Object.entries(manifest.peerDependencies ?? {})) {
                const devRange: string | undefined = manifest.devDependencies?.[name];
                if (devRange != undefined && !isAtLeast(lowerBoundOf(devRange), lowerBoundOf(peerRange))) {
                    outsidePeerRange[`${dir}: ${name}`] = `${devRange} is below the peer range ${peerRange}`;
                }
            }
        }

        // otherwise a fresh install may develop and test the package on a version it refuses to
        // consumers, and every check would be about a combination nobody can install
        expect(outsidePeerRange).toStrictEqual({});
    });
});

describe('the release workflow', () => {

    it('builds every package before it publishes any of them', () => {
        const steps: string[] = deploySteps();
        const builds: number[] = indexesMatching(steps, line => line.includes('npm run build'));
        const publishes: number[] = indexesMatching(steps, isRealPublish);

        // one build, one publish, next package - so `npm run build -w cli` failing was a half
        // release: `zibri` was on the registry already and its cli did not exist. A build failure
        // is by far the likeliest way to lose a release halfway, and it is the one kind of failure
        // that ordering alone removes, because nothing is published until everything compiles.
        //
        // Counted against the manifests rather than against a number written here, so that adding a
        // package to the release fails on the step it forgot rather than on nothing.
        expect(builds).toHaveLength(publishedPackages().length);
        expect(publishes).toHaveLength(publishedPackages().length);
        expect(Math.max(...builds)).toBeLessThan(Math.min(...publishes));
    });

    it('rehearses every publish before it performs any of them', () => {
        const steps: string[] = deploySteps();
        const dryRuns: number[] = indexesMatching(steps, line => line.includes('npm publish') && line.includes('--dry-run'));
        const publishes: number[] = indexesMatching(steps, isRealPublish);

        // npm refuses a manifest for reasons that have nothing to do with whether the code builds -
        // a file the packer cannot read, a name the account cannot publish. Finding that on the
        // last package leaves the earlier ones published.
        expect(dryRuns).toHaveLength(publishedPackages().length);
        expect(Math.max(...dryRuns)).toBeLessThan(Math.min(...publishes));
    });

    it('refuses a version the registry already has, before publishing anything', () => {
        const steps: string[] = deploySteps();
        const check: number = steps.findIndex(line => line.includes('npm view'));

        // forgetting to bump one of them is the everyday version of this, and npm answers it with a
        // conflict at the moment of publish - which for the last package is after the others have
        // gone out. Asked up front, it costs a failed release instead of a broken one.
        expect(check).toBeGreaterThanOrEqual(0);
        expect(check).toBeLessThan(Math.min(...indexesMatching(steps, isRealPublish)));

        // and it has to ask about every one of them: a package the loop does not name is one whose
        // version nothing checks, which is the same half released state by a slower route.
        const asked: string = steps.slice(check - 2, check + 2).join('\n');
        for (const name of publishedPackages()) {
            expect(asked).toContain(name);
        }
    });

    it('publishes one version across every package it releases', () => {
        const res: { agreed: string, refused: string } = inResolverProcess(`
            const { releaseVersion, declaredVersions } = await import('${pathToFileURL(releaseVersionPath).href}');
            let refused = 'it did not refuse';
            try {
                releaseVersion({ zibri: '3.1.0', 'zibri-tsx': '3.0.0' });
            }
            catch (error) {
                refused = error.message;
            }
            console.log(JSON.stringify({ agreed: releaseVersion(declaredVersions()), refused }));
        `);

        // they are released in lockstep and name each other by version - `zibri-testing` peer
        // depends on `zibri`, the cli installs both - so a release where they disagree is one that
        // cannot resolve. This reads the manifests this repository would publish right now, which is
        // the only way the check is about anything.
        expect(res.agreed).toMatch(/^\d+\.\d+\.\d+/);
        expect(res.refused).toContain('different versions');
    });

    it('publishes every package the generator installs by version', () => {
        // `zi new` installs `zibri` and `zibri-testing` at the cli's own version, so a package the
        // release leaves behind is one every generated project fails to install - and nothing about
        // the release itself would have looked wrong.
        const generator: string = readFileSync(
            path.join(packagesDir, 'cli', 'src', 'commands', 'new', 'new.command.ts'),
            'utf8'
        );
        const installedByVersion: string[] = [...generator.matchAll(/`(zibri[\w-]*)@\${version}`/g)]
            .map(m => m[1])
            .filter(name => name != undefined);

        expect(installedByVersion.length).toBeGreaterThan(0);
        for (const name of installedByVersion) {
            expect(publishedPackages()).toContain(name);
        }
    });

    it('refuses packages that name each other at a range other than the release', () => {
        const res: { current: string, refused: string } = inResolverProcess(`
            const { validateInternalRanges, declaredManifests, declaredVersions, releaseVersion } = await import('${pathToFileURL(releaseVersionPath).href}');
            let refused = 'it did not refuse';
            try {
                validateInternalRanges({
                    zibri: { version: '4.0.0', peerDependencies: { 'zibri-tsx': '^3.0.0', express: '^5.0.0' } },
                    'zibri-tsx': { version: '4.0.0' }
                }, '4.0.0');
            }
            catch (error) {
                refused = error.message;
            }
            const manifests = declaredManifests();
            validateInternalRanges(manifests, releaseVersion(declaredVersions(manifests)));
            console.log(JSON.stringify({ current: 'accepted', refused }));
        `);

        // every version agreeing is not enough: a major bump that leaves `zibri`'s peer range on
        // `zibri-tsx` at the previous major publishes two packages that refuse each other
        expect(res.refused).toContain('zibri peerDependencies.zibri-tsx@^3.0.0');
        expect(res.refused).not.toContain('express');
        expect(res.current).toBe('accepted');
    });

    it('refuses a release without notes, and a version that already has a tag, before publishing anything', () => {
        const steps: string[] = deploySteps();
        const firstPublish: number = Math.min(...indexesMatching(steps, isRealPublish));

        // both of these are needed by the step that tags the release, which runs after the publishes -
        // found there, they leave four published packages and no release saying what they are
        expect(steps.findIndex(line => line.includes('release-notes.mjs'))).toBeGreaterThanOrEqual(0);
        expect(steps.findIndex(line => line.includes('release-notes.mjs'))).toBeLessThan(firstPublish);
        expect(steps.findIndex(line => line.includes('git ls-remote --exit-code --tags'))).toBeGreaterThanOrEqual(0);
        expect(steps.findIndex(line => line.includes('git ls-remote --exit-code --tags'))).toBeLessThan(firstPublish);
    });

    it('reads the notes of one version out of the changelog', () => {
        const changelog: string = [
            '# Changelog',
            '',
            '## 3.1.0',
            '',
            '- Adds a thing.',
            '',
            '## 3.0.1',
            '',
            '## 3.0.0',
            '',
            '- The first one.',
            ''
        ].join('\n');
        const res: Record<string, string> = inResolverProcess(`
            const { resolveReleaseNotes } = await import('${pathToFileURL(releaseNotesPath).href}');
            const changelog = ${JsonUtilities.stringify(changelog)};
            const outcome = version => {
                try {
                    return resolveReleaseNotes(changelog, version);
                }
                catch (error) {
                    return error.message;
                }
            };
            console.log(JSON.stringify({
                newest: outcome('3.1.0'),
                last: outcome('3.0.0'),
                empty: outcome('3.0.1'),
                missing: outcome('3.2.0'),
                prefix: outcome('3.1')
            }));
        `);

        expect(res['newest']).toBe('- Adds a thing.');
        expect(res['last']).toBe('- The first one.');
        // what cannot be generated is at least impossible to forget
        expect(res['empty']).toContain('is empty');
        expect(res['missing']).toContain('has no section "## 3.2.0"');
        expect(res['prefix']).toContain('has no section "## 3.1"');
    });

    it('tags the release after every publish, with its notes', () => {
        const steps: string[] = deploySteps();
        const release: number = steps.findIndex(line => line.includes('gh release create'));

        // a tag says a version exists, so it is only true once the last package is on the registry
        expect(release).toBeGreaterThan(Math.max(...indexesMatching(steps, isRealPublish)));
        expect(steps.slice(release, release + 4).join('\n')).toContain('--notes-file "$RUNNER_TEMP/release-notes.md"');
        expect(workflow('cd.yml')).toContain('contents: write');
    });

    it('tags a release on npm by where it sits among the published versions', () => {
        const res: Record<string, string> = inResolverProcess(`
            const { resolveDistTag } = await import('${pathToFileURL(releaseVersionPath).href}');
            const outcome = (version, published) => {
                try {
                    return resolveDistTag(version, published);
                }
                catch (error) {
                    return error.message;
                }
            };
            console.log(JSON.stringify({
                newest: outcome('3.0.0', ['2.5.0', '2.4.1']),
                first: outcome('1.0.0', []),
                prerelease: outcome('4.0.0-rc.1', ['3.0.0']),
                olderMajor: outcome('3.0.1', ['3.0.0', '4.0.0']),
                olderMajorWithItsOwnPrerelease: outcome('3.0.1', ['3.0.0', '3.1.0-rc.1', '4.0.0']),
                behindItsMajor: outcome('3.0.1', ['3.0.0', '3.1.0', '4.0.0']),
                behindLatest: outcome('3.0.1', ['3.0.0', '3.1.0'])
            }));
        `);

        expect(res['newest']).toBe('latest');
        expect(res['first']).toBe('latest');
        // npm refuses a prerelease without a tag, and `latest` would hand it to every install
        expect(res['prerelease']).toBe('next');
        // a fix for an older major must not move `latest` back underneath everyone on the newer one
        expect(res['olderMajor']).toBe('latest-3');
        expect(res['olderMajorWithItsOwnPrerelease']).toBe('latest-3');
        // and `latest-3` must not move back underneath everyone on 3.1.0
        expect(res['behindItsMajor']).toContain('3.0.1 is below 3.1.0');
        expect(res['behindLatest']).toContain('3.0.1 is below 3.1.0');
    });

    it('publishes, marks and documents a release under the tag it resolved', () => {
        const content: string = workflow('cd.yml');
        const steps: string[] = deploySteps();
        const tagged: string = '--tag "${{ steps.version.outputs.dist_tag }}"';
        const release: number = steps.findIndex(line => line.includes('gh release create'));
        const docsJob: string = content.slice(content.indexOf('    updateDocs:'));

        // one publish without it is one package moved to `latest` while the other three are not
        for (const line of steps.filter(step => step.includes('npm publish'))) {
            expect(line).toContain(tagged);
        }
        expect(steps.slice(release, release + 7).join('\n')).toContain('--latest=${{ steps.version.outputs.dist_tag == \'latest\' }}');
        // the site is the newest release's, and only once that release is out
        expect(docsJob).toContain('needs: deploy');
        expect(docsJob).toContain('if: needs.deploy.outputs.dist_tag == \'latest\'');
        // a `release-<major>` branch releases like `release` does, from the commit that was merged
        expect(content).toContain('branches: [release, \'release-*\']');
        expect(content).not.toContain('ref: release');
        expect(content.split('ref: ${{ github.event.pull_request.merge_commit_sha }}')).toHaveLength(3);
    });

    it('bumps every manifest, the lockfile and the changelog into a release the checks accept', () => {
        const res: {
            unchanged: boolean,
            versions: Record<string, string>,
            lockVersions: Record<string, string>,
            zibriPeers: Record<string, string>,
            changelog: string,
            changelogTwice: string
        } = inResolverProcess(`
            const { readFileSync } = await import('node:fs');
            const path = await import('node:path');
            const { bumpManifest, bumpLockfile, addChangelogSection } = await import('${pathToFileURL(bumpVersionPath).href}');
            const { published, repoRoot, declaredManifests, declaredVersions, releaseVersion, validateInternalRanges } = await import('${pathToFileURL(releaseVersionPath).href}');
            const current = declaredManifests();
            const names = new Set(Object.keys(current));
            const currentVersion = releaseVersion(declaredVersions(current));
            const texts = published.map(dir => readFileSync(path.join(repoRoot, 'packages', dir, 'package.json'), 'utf8'));
            const lockText = readFileSync(path.join(repoRoot, 'package-lock.json'), 'utf8');

            const unchanged = texts.every(text => bumpManifest(text, currentVersion, names) === text)
                && bumpLockfile(lockText, currentVersion, names) === lockText;

            const bumped = Object.fromEntries(texts.map(text => JSON.parse(bumpManifest(text, '9.0.0', names))).map(m => [m.name, m]));
            validateInternalRanges(bumped, releaseVersion(declaredVersions(bumped)));
            const lock = JSON.parse(bumpLockfile(lockText, '9.0.0', names));
            const changelog = addChangelogSection('# Changelog\\n\\nIntro.\\n\\n## 3.0.0\\n\\n- The first one.\\n', '9.0.0');

            console.log(JSON.stringify({
                unchanged,
                versions: declaredVersions(bumped),
                lockVersions: Object.fromEntries(published.map(dir => [dir, lock.packages['packages/' + dir].version])),
                zibriPeers: bumped.zibri.peerDependencies,
                changelog,
                changelogTwice: addChangelogSection(changelog, '9.0.0')
            }));
        `);

        // bumping to the version already declared rewrites nothing, so the files are written the
        // way npm writes them and a bump's diff is the bump
        expect(res.unchanged).toBe(true);
        expect(new Set(Object.values(res.versions))).toStrictEqual(new Set(['9.0.0']));
        // `npm ci` refuses a lockfile whose workspace entries disagree with the manifests
        expect(new Set(Object.values(res.lockVersions))).toStrictEqual(new Set(['9.0.0']));
        expect(res.zibriPeers['zibri-tsx']).toBe('^9.0.0');
        expect(res.zibriPeers['express']).not.toBe('^9.0.0');
        expect(res.changelog).toBe('# Changelog\n\nIntro.\n\n## 9.0.0\n\n## 3.0.0\n\n- The first one.\n');
        expect(res.changelogTwice).toBe(res.changelog);
    });

});