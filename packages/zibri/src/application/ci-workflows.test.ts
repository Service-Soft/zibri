import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from '@jest/globals';

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
        const manifest: { engines?: { node?: string } } = JSON.parse(
            readFileSync(manifestPath, 'utf8')
        ) as { engines?: { node?: string } };
        const range: string | undefined = manifest.engines?.node;
        if (range == undefined) {
            continue;
        }
        result[dir.name] = Number(/>=\s*(\d+)/.exec(range)?.[1]);
    }
    return result;
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
    return JSON.parse(output) as T;
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
            const schedule = ${JSON.stringify(schedule)};
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
        expect(workflow('ci.yml')).toContain('npm audit');
        expect(readdirSync(workflowsDir)).toContain('codeql.yml');
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

});