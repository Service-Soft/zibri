/* eslint-disable jsdoc/require-jsdoc */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// what the benchmark suites measure on this checkout, set against what they measure on the release it
// would replace, failing on an operation that got worse: slower, or holding more memory, or spending
// more CPU. Both sides are built and run here, in turns, so that the machine weighs on both alike -
// which no recorded number can offer, and which is what makes a threshold that fails a build fair.
// Usage: node scripts/compare-benchmarks.mjs <npm script> [group], against origin/release unless
// ZIBRI_BENCHMARK_AGAINST names another ref. With a group, only the suites of that group are compared;
// `--groups` prints the names of every group, `--merge <folder>` sums up the comparisons the groups
// wrote into that folder

// how much worse than on the release a measurement may be before the comparison fails, unless an
// allowance for that release says otherwise
export const SLOWER_FROM_RATIO = 1.3;

// how often each side runs the suites; the median of the rounds is what is compared
const ROUNDS = 4;

// how much more memory than on the release a figure may hold before its ratio counts at all: peak
// memory of a few dozen MiB moves by more than the ratio from one run to the next, with when the
// collector happens to run
export const MEMORY_SLACK_BYTES = 16 * 1024 * 1024;

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(packageDir, '..', '..');
// beside the repository rather than under the system's temp directory: the release is run with its
// own jest configuration, and the one of 3.0.0 ignores every path with `tmp` in it, so under /tmp
// its suites were found nowhere. Next to the checkout, a path is what the checkout's own is
export const worktreeParent = path.dirname(repoRoot);
// a slowdown found to be worth it: { against, name, ratio, reason }, counting for as long as the
// release `against` is the one compared with
const allowancesPath = path.join(packageDir, 'benchmark-allowances.json');
// the suites each runner of the benchmark job compares: { [group]: [suite, ...] }, each suite as a path
// relative to the package. A group is made of whole suites, and every operation is measured by one
// suite, so both sides of each are still run on one machine, in turns - which is what the threshold
// relies on. The job takes as long as its longest group rather than as long as every suite
const groupsPath = path.join(packageDir, 'benchmark-groups.json');

// the group of every suite no other group names, so that a suite added, or one only the release has,
// is compared without being listed anywhere
export const REST_GROUP = 'rest';

// what the live phases of a backup measurement are left out by: they are a design check of the
// checkout, which its first round makes, and a quarter of a measurement's time in every other one
const SKIP_HELD_MEMORY_ENV = 'ZIBRI_BENCHMARK_SKIP_HELD_MEMORY';

export function medianOf(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// one run of the suites, from the content of each of its reports: { values: { [name]: value },
// units: { [name]: unit } }. An entry is a timing ({ timing: { name, medianMs } }), which is all a
// release before 3.1 reports, or a figure ({ figure: { name, value, unit } })
export function resolveRound(reports) {
    const values = {};
    const units = {};
    for (const entry of reports.flat()) {
        const measured = entry.timing == undefined
            ? { name: entry.figure.name, value: entry.figure.value, unit: entry.figure.unit }
            : { name: entry.timing.name, value: entry.timing.medianMs, unit: 'ms' };
        if (values[measured.name] != undefined) {
            throw new Error(`Two benchmarks are named "${measured.name}", so neither can be compared.`);
        }
        values[measured.name] = measured.value;
        units[measured.name] = measured.unit;
    }
    return { values, units };
}

// each round is { [name]: value }, as one run of the suites reported it. Lower is better for every
// one of them. units is { [name]: unit }, as resolveRound reads it: 'ms' when a name has none
export function resolveComparison(releaseRounds, currentRounds, allowances, releaseVersion, units = {}) {
    const names = [...new Set(currentRounds.flatMap(round => Object.keys(round)))];
    const rows = names.map(name => {
        const currentMs = medianOf(currentRounds.map(round => round[name]).filter(ms => ms != undefined));
        const releaseTimes = releaseRounds.map(round => round[name]).filter(ms => ms != undefined);
        if (releaseTimes.length === 0) {
            return { name, releaseMs: null, currentMs, ratio: null, limit: null, verdict: 'new' };
        }
        const releaseMs = medianOf(releaseTimes);
        // nothing on both sides is unchanged: divided, it is no number, which is within every limit and
        // reads as one in the table. Nothing on the release and something here stays beyond every limit
        const ratio = releaseMs === 0 && currentMs === 0 ? 1 : currentMs / releaseMs;
        const limit = allowances.find(allowance => allowance.name === name && allowance.against === releaseVersion)?.ratio
            ?? SLOWER_FROM_RATIO;
        const beyondSlack = units[name] !== 'bytes' || currentMs - releaseMs > MEMORY_SLACK_BYTES;
        return { name, releaseMs, currentMs, ratio, limit, verdict: ratio > limit && beyondSlack ? 'worse' : 'ok' };
    });
    // what only the release measures: removed here, or renamed, in which case its new name is a row that
    // is compared with nothing. Reported, so that a slowdown behind a rename has a row saying where to look
    const gone = [...new Set(releaseRounds.flatMap(round => Object.keys(round)))]
        .filter(name => !names.includes(name))
        .map(name => ({
            name,
            releaseMs: medianOf(releaseRounds.map(round => round[name]).filter(ms => ms != undefined)),
            currentMs: null,
            ratio: null,
            limit: null,
            verdict: 'gone'
        }));
    rows.push(...gone);
    return { releaseVersion, rows, failed: rows.some(row => row.verdict === 'worse') };
}

// rows are those of every suite: an allowance whose operation a group did not measure is no stale one
// of the group that left it out
export function resolveStaleAllowances(allowances, rows, releaseVersion) {
    // once its release is replaced the slower code is the release, and an operation back within the
    // threshold needs none: either way the allowance would let the next slowdown through unseen
    return allowances.filter(allowance => {
        const ratio = rows.find(row => row.name === allowance.name)?.ratio;
        return allowance.against !== releaseVersion || ratio == undefined || ratio <= SLOWER_FROM_RATIO;
    });
}

// groups is { [group]: [suite, ...] }; the names of the groups the job runs, the rest included
export function resolveGroupNames(groups) {
    return [...Object.keys(groups), REST_GROUP];
}

// suites are those one side has, as paths relative to the package; the ones of the group among them
export function resolveGroupSuites(groups, group, suites) {
    if (group === REST_GROUP) {
        const grouped = new Set(Object.values(groups).flat());
        return suites.filter(suite => !grouped.has(suite));
    }
    const named = groups[group];
    if (named == undefined) {
        throw new Error(`There is no benchmark group "${group}", only ${resolveGroupNames(groups).join(', ')}.`);
    }
    return suites.filter(suite => named.includes(suite));
}

// against the suites of the checkout: a group naming a suite that is gone would compare nothing, and
// one named twice would be compared on two runners
export function validateGroups(groups, suites) {
    const named = Object.values(groups).flat();
    const problems = [
        ...named.filter(suite => !suites.includes(suite)).map(suite => `"${suite}" is no benchmark suite of this checkout`),
        ...named.filter((suite, index) => named.indexOf(suite) !== index).map(suite => `"${suite}" is in more than one group`),
        ...Object.hasOwn(groups, REST_GROUP) ? [`"${REST_GROUP}" is the group of every suite no other group names`] : []
    ];
    if (problems.length > 0) {
        throw new Error(`${path.relative(repoRoot, groupsPath)} needs fixing:\n${problems.join('\n')}`);
    }
}

// comparisons are what each group wrote; one for every group, of the same release
export function resolveMergedComparison(comparisons, groupNames, allowances) {
    const missing = groupNames.filter(name => !comparisons.some(comparison => comparison.group === name));
    if (missing.length > 0) {
        throw new Error(`No comparison of ${missing.join(', ')}: the job of each failed before it compared anything.`);
    }
    const releaseVersions = [...new Set(comparisons.map(comparison => comparison.releaseVersion))];
    if (releaseVersions.length !== 1) {
        throw new Error(`The groups were compared with different releases: ${releaseVersions.join(', ')}.`);
    }
    const [releaseVersion] = releaseVersions;
    const rows = comparisons.flatMap(comparison => comparison.rows);
    return {
        releaseVersion,
        rows,
        staleAllowances: resolveStaleAllowances(allowances, rows, releaseVersion),
        failed: rows.some(row => row.verdict === 'worse'),
        units: Object.assign({}, ...comparisons.map(comparison => comparison.units))
    };
}

// units is { [name]: unit }, as resolveRound reads it: 'ms' when a name has none. staleAllowances only
// when the comparison holds every suite
export function resolveTable(comparison, units = {}, staleAllowances = []) {
    const format = (value, unit) => {
        if (value == undefined) {
            return '-';
        }
        return unit === 'bytes' ? `${(value / (1024 * 1024)).toFixed(1)} MiB` : `${value.toFixed(3)} ms`;
    };
    const notCompared = { new: 'not measured on the release', gone: 'no longer measured here' };
    const rows = comparison.rows.map(row => {
        const verdict = notCompared[row.verdict]
            ?? `${row.ratio.toFixed(2)}x, limit ${row.limit}x${row.verdict === 'worse' ? ', **worse**' : ''}`;
        const unit = units[row.name] ?? 'ms';
        return `| ${row.name} | ${format(row.releaseMs, unit)} | ${format(row.currentMs, unit)} | ${verdict} |`;
    });
    const stale = staleAllowances
        .map(allowance => `- the allowance for "${allowance.name}" against ${allowance.against} no longer applies: remove it`);
    return [
        `| operation | release ${comparison.releaseVersion} | this checkout | against it |`,
        '|---|---|---|---|',
        ...rows,
        ...stale.length > 0 ? ['', ...stale] : []
    ].join('\n');
}

// the workspaces a checkout at root is built from before its benchmarks run, in the order the job
// builds them: zibri imports each package before it. Only those the checkout has, so that a release
// from before a package was split off still builds
export function resolveWorkspacesToBuild(root) {
    const before = [['contract', 'zibri-contract'], ['tsx', 'zibri-tsx'], ['tsx-compiler', 'zibri-tsx-compiler'], ['mdx', 'zibri-mdx']]
        .filter(([dir]) => existsSync(path.join(root, 'packages', dir)))
        .map(([, workspace]) => workspace);
    return [...before, 'zibri'];
}

function reportsDirOf(root) {
    return path.join(root, 'packages', 'zibri', 'src', '__testing__', 'file-output');
}

function reportsIn(dir) {
    return existsSync(dir) ? readdirSync(dir).filter(name => name.endsWith('benchmark-report.json')) : [];
}

function readAllowances() {
    return JSON.parse(readFileSync(allowancesPath, 'utf8'));
}

function readGroups() {
    return JSON.parse(readFileSync(groupsPath, 'utf8'));
}

function comparisonPathOf(group) {
    return path.join(reportsDirOf(repoRoot), group == undefined ? 'benchmark-comparison.json' : `benchmark-comparison-${group}.json`);
}

function validateRef(ref) {
    try {
        execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: repoRoot, stdio: 'ignore' });
    }
    catch {
        throw new Error(`There is no ${ref} to compare with. Fetch it first: git fetch origin release`);
    }
}

function readJsonAt(ref, file) {
    try {
        execFileSync('git', ['cat-file', '-e', `${ref}:${file}`], { cwd: repoRoot, stdio: 'ignore' });
    }
    catch {
        return undefined;
    }
    return JSON.parse(execFileSync('git', ['show', `${ref}:${file}`], { cwd: repoRoot, encoding: 'utf8' }));
}

function run(command, args, cwd, env = process.env) {
    execFileSync(command, args, { cwd, env, stdio: 'inherit', shell: process.platform === 'win32' });
}

// to the job's summary as well, where a pull request shows it without opening an artifact
function write(text) {
    process.stdout.write(`\n${text}\n\n`);
    if (process.env.GITHUB_STEP_SUMMARY != undefined) {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
    }
}

// the benchmark suites a side's own script runs, as paths relative to its package, read off jest
// rather than the files, so that each side answers by its own configuration
function listSuites(root, script) {
    const packageRoot = path.join(root, 'packages', 'zibri');
    const listed = execFileSync('npm', ['run', '--silent', script, '-w', 'zibri', '--', '--listTests'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'inherit'],
        shell: process.platform === 'win32'
    });
    return listed.split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => path.isAbsolute(line))
        .map(
            line => path.relative(packageRoot, line)
                .split(path.sep)
                .join('/')
        )
        .sort();
}

// suites undefined runs every one the script runs; an empty list runs nothing, for a side without any
// suite of the group
function runSuites(root, script, suites, measureHeld) {
    if (suites?.length === 0) {
        return { values: {}, units: {} };
    }
    const reportsDir = reportsDirOf(root);
    // a report an earlier run left behind would be read as this one's
    for (const name of reportsIn(reportsDir)) {
        rmSync(path.join(reportsDir, name));
    }
    const env = { ...process.env };
    delete env.ZIBRI_BENCHMARK_UPDATE_BASELINE;
    if (!measureHeld) {
        env[SKIP_HELD_MEMORY_ENV] = '1';
    }
    // by path rather than by another pattern, which jest would match in addition to the script's own:
    // the paths are all it runs, whatever the script names
    const selection = suites == undefined
        ? []
        : ['--', '--runTestsByPath', ...suites.map(suite => path.join(root, 'packages', 'zibri', suite))];
    run('npm', ['run', script, '-w', 'zibri', ...selection], root, env);

    return resolveRound(reportsIn(reportsDir).map(name => JSON.parse(readFileSync(path.join(reportsDir, name), 'utf8'))));
}

function writeComparison(group, comparison, units) {
    mkdirSync(reportsDirOf(repoRoot), { recursive: true });
    writeFileSync(comparisonPathOf(group), JSON.stringify({ group, ...comparison, units }, undefined, 4));
}

function compareWithRelease(script, group) {
    const against = process.env.ZIBRI_BENCHMARK_AGAINST ?? 'origin/release';
    validateRef(against);
    const manifest = readJsonAt(against, 'packages/zibri/package.json');
    const groups = readGroups();
    const checkoutSuites = group == undefined ? undefined : listSuites(repoRoot, script);
    if (checkoutSuites != undefined) {
        validateGroups(groups, checkoutSuites);
    }
    const currentSuites = checkoutSuites == undefined ? undefined : resolveGroupSuites(groups, group, checkoutSuites);
    if (manifest?.scripts?.[script] == undefined) {
        write(`${against} runs no "${script}", so there is nothing to compare with yet.`);
        // written all the same, so that the summary of the groups finds one of each
        writeComparison(group, { releaseVersion: manifest?.version, rows: [], failed: false }, {});
        return;
    }

    const worktree = mkdtempSync(path.join(worktreeParent, 'zibri-benchmark-release-'));
    run('git', ['worktree', 'add', '--detach', worktree, against], repoRoot);
    try {
        // installed and built the way the job builds this checkout
        run('npm', ['ci'], worktree);
        for (const workspace of resolveWorkspacesToBuild(worktree)) {
            run('npm', ['run', 'build', '-w', workspace], worktree);
        }
        // the same group on the release, by the groups of this checkout: a suite is compared on the
        // runner it is run on here
        const releaseSuites = group == undefined ? undefined : resolveGroupSuites(groups, group, listSuites(worktree, script));
        const releaseRounds = [];
        const currentRounds = [];
        for (let round = 0; round < ROUNDS; round++) {
            // the release first every other round, so that a machine slowing down or speeding up over
            // the run weighs on both sides alike
            const sides = [[worktree, releaseSuites, releaseRounds, false], [repoRoot, currentSuites, currentRounds, round === 0]];
            for (const [root, suites, rounds, measureHeld] of round % 2 === 0 ? sides : sides.reverse()) {
                rounds.push(runSuites(root, script, suites, measureHeld));
            }
        }

        const units = Object.assign({}, ...currentRounds.map(round => round.units));
        const comparison = resolveComparison(
            releaseRounds.map(round => round.values),
            currentRounds.map(round => round.values),
            readAllowances(),
            manifest.version,
            units
        );
        writeComparison(group, comparison, units);
        // the allowances that no longer apply only once every suite was compared, which the summary of
        // the groups does
        const staleAllowances = group == undefined ? resolveStaleAllowances(readAllowances(), comparison.rows, manifest.version) : [];
        write(resolveTable(comparison, units, staleAllowances));
        if (comparison.failed) {
            process.exitCode = 1;
        }
    }
    finally {
        run('git', ['worktree', 'remove', '--force', worktree], repoRoot);
    }
}

function mergeComparisons(folder) {
    const comparisons = readdirSync(folder)
        .filter(name => /^benchmark-comparison-.+\.json$/.test(name))
        .map(name => JSON.parse(readFileSync(path.join(folder, name), 'utf8')));
    const merged = resolveMergedComparison(comparisons, resolveGroupNames(readGroups()), readAllowances());
    write(resolveTable(merged, merged.units, merged.staleAllowances));
    if (merged.failed) {
        process.exitCode = 1;
    }
}

function main() {
    const [first, second] = process.argv.slice(2);
    if (first === '--groups') {
        // as a step output of the job that hands them to the matrix
        process.stdout.write(`groups=${JSON.stringify(resolveGroupNames(readGroups()))}\n`);
        return;
    }
    if (first === '--merge') {
        mergeComparisons(second);
        return;
    }
    compareWithRelease(first, second);
}

// argv[1] is undefined when this module is imported by a `--eval` script rather than run
if (process.argv[1] != undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}