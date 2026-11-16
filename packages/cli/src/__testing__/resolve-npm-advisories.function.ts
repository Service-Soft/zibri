import { NpmAdvisories } from './npm-advisories.model';
import { CPUtilities } from '../encapsulation';
import { Path } from '../utilities';

/**
 * An advisory npm audit found for a package that is installed in an affected version.
 */
type NpmAuditAdvisory = {
    /**
     * The package the advisory is about.
     */
    name: string,
    /**
     * What it says.
     */
    title: string,
    /**
     * Where it is published.
     */
    url: string,
    /**
     * How bad npm rates it.
     */
    severity: string,
    /**
     * The versions it affects.
     */
    range: string
};

/**
 * What `npm audit --json` writes: each vulnerable package, with the advisories about it or the names of the vulnerable
 * packages it depends on.
 */
type NpmAuditReport = {
    /**
     * The vulnerable packages, by name.
     */
    vulnerabilities?: Record<string, {
        /**
         * An advisory about the package itself, or the name of a vulnerable package it is vulnerable through.
         */
        via: (NpmAuditAdvisory | string)[]
    }>
};

/**
 * Finds every advisory npm audit reports for a project: npm prints its summary after each install of `zi new`, into
 * the terminal of whoever runs it.
 *
 * One about a development dependency whose newest release is still affected is apart: nothing the project installs
 * can fix it until one is published.
 * @param projectDir - The installed project.
 * @returns Each advisory once, though the packages depending on its package count it again in npm's summary.
 */
export function resolveNpmAdvisories(projectDir: Path): NpmAdvisories {
    const all: NpmAuditAdvisory[] = findAuditAdvisories(projectDir, []);
    const ofProduction: Set<string> = new Set(
        findAuditAdvisories(projectDir, ['--omit', 'dev']).map(advisory => advisory.url)
    );
    const advisories: NpmAdvisories = { fixable: [], unfixed: [] };
    for (const advisory of all) {
        const { name, range, severity, title, url } = advisory;
        const description: string = `npm audit: ${name}@${range} (${severity}): ${title}, ${url}`;
        const fixable: boolean = ofProduction.has(url) || !isNewestAffected(advisory, projectDir);
        (fixable ? advisories.fixable : advisories.unfixed).push(description);
    }
    return advisories;
}

/**
 * Runs npm audit, and finds the advisories it reports.
 * @param projectDir - The installed project.
 * @param args - What npm audit is run with beside, such as `--omit dev`.
 * @returns Each advisory once.
 */
function findAuditAdvisories(projectDir: Path, args: string[]): NpmAuditAdvisory[] {
    // an exit code other than 0 is how npm audit says it found something
    const { stdout } = CPUtilities.resolveResult('npm', ['audit', '--json', ...args], projectDir);
    const report: NpmAuditReport = JSON.parse(stdout.toString('utf8')) as NpmAuditReport;
    const advisories: NpmAuditAdvisory[] = Object.values(report.vulnerabilities ?? {})
        .flatMap(vulnerability => vulnerability.via)
        .filter(via => typeof via !== 'string');
    return [...new Map(advisories.map(advisory => [advisory.url, advisory])).values()];
}

/**
 * Whether the newest release of the package an advisory is about is still affected by it, as the registry says.
 * @param advisory - The advisory.
 * @param projectDir - Where npm runs, for the registry it is configured with.
 * @returns Whether no release fixed it.
 */
function isNewestAffected(advisory: NpmAuditAdvisory, projectDir: Path): boolean {
    const newest: unknown = viewVersions(advisory.name, projectDir);
    // a single version as a string, several as a list
    const affected: unknown = viewVersions(`${advisory.name}@${advisory.range}`, projectDir);
    return Array.isArray(affected) ? affected.includes(newest) : affected === newest;
}

/**
 * Asks the registry for the versions of a package.
 * @param spec - The package, with the range the versions are to be in, or without for the newest one.
 * @param projectDir - Where npm runs, for the registry it is configured with.
 * @returns The version, or the list of versions when there are several.
 */
function viewVersions(spec: string, projectDir: Path): unknown {
    return JSON.parse(CPUtilities.resolveResult('npm', ['view', spec, 'version', '--json'], projectDir).stdout.toString('utf8'));
}