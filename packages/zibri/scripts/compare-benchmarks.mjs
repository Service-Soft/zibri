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

// how often each side runs a suite both have, unless its group says otherwise; the median of the rounds
// is what is compared
const ROUNDS = 4;

// how much more memory than on the release a figure may hold before its ratio counts at all: peak
// memory of a few dozen MiB moves by more than the ratio from one run to the next, with when the
// collector happens to run
// 64 MiB, by what the same code on both sides differed by: what a phase grows the memory by came out up
// to 30 MiB apart as the mean of two rounds, with whether the pages freed before it were kept. A backup
// that starts holding a resource of 100 MB whole is beyond it still
export const MEMORY_SLACK_BYTES = 64 * 1024 * 1024;

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(packageDir, '..', '..');
// beside the repository rather than under the system's temp directory: the release is run with its
// own jest configuration, and the one of 3.0.0 ignores every path with `tmp` in it, so under /tmp
// its suites were found nowhere. Next to the checkout, a path is what the checkout's own is
export const worktreeParent = path.dirname(repoRoot);
// a slowdown found to be worth it: { against, name, ratio, reason }, counting for as long as the
// release `against` is the one compared with
const allowancesPath = path.join(packageDir, 'benchmark-allowances.json');
// the suites each runner of the benchmark job compares: { [group]: { suites: [suite, ...], rounds?,
// narrowed?: { rounds, env } } }, each suite as a path relative to the package, how often each side runs
// it when that is not ROUNDS, and the rounds it runs after those in an environment that has it measure
// less. A group is made of whole suites, and every operation is measured by one suite, so both sides of
// each are still run on one machine, in turns - which is what the threshold relies on. The job takes as
// long as its longest group rather than as long as every suite
const groupsPath = path.join(packageDir, 'benchmark-groups.json');

// the group of every suite no other group names, so that a suite added, or one only the release has,
// is compared without being listed anywhere
export const REST_GROUP = 'rest';

// what the live phases of a backup measurement are left out by: they are a design check of the
// checkout, which its first round makes, and a quarter of a measurement's time in every other one
const SKIP_HELD_MEMORY_ENV = 'ZIBRI_BENCHMARK_SKIP_HELD_MEMORY';

// what glibc hands back to the system as it is freed, set for the suites of both sides: everything of
// 128 KiB or more, its starting point. Left alone, it raises that as a process frees larger blocks, and
// keeps what it freed from then on, so what a phase grows the memory by depends on what the phases
// before it happened to free: a restore of 100 MB of valkey came out at 69 MiB in one round and at 186
// in the next, of the same code. Set, a phase grows it by what it needs each time. On the release as
// well, whose suites do not set it themselves. Other allocators take no notice
const ALLOCATOR_ENV = { MALLOC_MMAP_THRESHOLD_: '131072', MALLOC_TRIM_THRESHOLD_: '131072' };

export function medianOf(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// one run of the suites, from the content of each of its reports: { values: { [name]: value },
// units: { [name]: unit }, slacks: { [name]: slack } }. An entry is a timing ({ timing: { name, medianMs } }),
// which is all a release before 3.1 reports, or a figure ({ figure: { name, value, unit, slack? } })
export function resolveRound(reports) {
    const values = {};
    const units = {};
    const slacks = {};
    for (const entry of reports.flat()) {
        const measured = entry.timing == undefined
            ? { name: entry.figure.name, value: entry.figure.value, unit: entry.figure.unit, slack: entry.figure.slack }
            : { name: entry.timing.name, value: entry.timing.medianMs, unit: 'ms' };
        if (values[measured.name] != undefined) {
            throw new Error(`Two benchmarks are named "${measured.name}", so neither can be compared.`);
        }
        values[measured.name] = measured.value;
        units[measured.name] = measured.unit;
        if (measured.slack != undefined) {
            slacks[measured.name] = measured.slack;
        }
    }
    return { values, units, slacks };
}

// each round is { [name]: value }, as one run of the suites reported it. Lower is better for every
// one of them. units is { [name]: unit }, as resolveRound reads it: 'ms' when a name has none. slacks is
// { [name]: slack }: how much more than on the release a value may be before its ratio counts at all,
// for a figure that says so. One that says nothing has MEMORY_SLACK_BYTES when it counts bytes, and none
// otherwise
export function resolveComparison(releaseRounds, currentRounds, allowances, releaseVersion, units = {}, slacks = {}) {
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
        const slack = slacks[name] ?? (units[name] === 'bytes' ? MEMORY_SLACK_BYTES : 0);
        const beyondSlack = currentMs - releaseMs > slack;
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

// groups is { [group]: { suites: [suite, ...], rounds? } }; the names of the groups the job runs, the
// rest included
export function resolveGroupNames(groups) {
    return [...Object.keys(groups), REST_GROUP];
}

// suites are those one side has, as paths relative to the package; the ones of the group among them
export function resolveGroupSuites(groups, group, suites) {
    if (group === REST_GROUP) {
        const grouped = new Set(Object.values(groups).flatMap(named => named.suites));
        return suites.filter(suite => !grouped.has(suite));
    }
    const named = groups[group];
    if (named == undefined) {
        throw new Error(`There is no benchmark group "${group}", only ${resolveGroupNames(groups).join(', ')}.`);
    }
    return suites.filter(suite => named.suites.includes(suite));
}

// how often each side runs a suite of the group that both have: what the group says, such as fewer for
// suites that take minutes and take a median of their own in every run, and ROUNDS otherwise, as for
// the rest and for a comparison of every suite
export function resolveGroupRounds(groups, group) {
    return groups[group]?.rounds ?? ROUNDS;
}

// what each round of a group adds to the environment of its suites, in the order the rounds run: nothing
// for those that run the suites as they are, and after them what the group narrows further rounds with,
// such as the one size of data its suites then measure.
// What a suite measures in seconds is what moves the most from one run to the next: one collection falling
// into a restore of 10 MB, or one moment of a slow disk, is half of it, and nothing of a restore of 100 MB
// that takes minutes. So a group run twice for what takes minutes is run again for what takes seconds,
// and each operation is compared by the median of the rounds that measured it: of two, the median is the
// mean, which one such round decided
export function resolveRoundEnvironments(groups, group) {
    const narrowed = groups[group]?.narrowed;
    return [
        ...Array.from({ length: resolveGroupRounds(groups, group) }, () => ({})),
        ...Array.from({ length: narrowed?.rounds ?? 0 }, () => ({ ...narrowed.env }))
    ];
}

// whether the narrowed rounds of a group say how many they are and what narrows them: an environment that
// sets nothing would run everything again under another name
function isNarrowing(narrowed) {
    return Number.isInteger(narrowed.rounds)
        && narrowed.rounds >= 1
        && typeof narrowed.env === 'object'
        && narrowed.env != undefined
        && Object.keys(narrowed.env).length > 0
        && Object.values(narrowed.env).every(value => typeof value === 'string');
}

// the suites each side runs in a round, of those it has: all of them in the first, and from then on
// those both have. A suite only one side has is compared with nothing, so that running it again is
// time spent on a median nobody reads, and its own checks have run by then
export function resolveRoundSuites(currentSuites, releaseSuites, round) {
    if (round === 0) {
        return { current: currentSuites, release: releaseSuites };
    }
    return {
        current: currentSuites.filter(suite => releaseSuites.includes(suite)),
        release: releaseSuites.filter(suite => currentSuites.includes(suite))
    };
}

// the suites a ref's script runs, read off the files of the ref and the pattern its script names
// rather than by running it, which takes the ref installed: files as paths relative to the repository,
// the suites as paths relative to the package. Nothing for a script that names no pattern, whose
// suites only running it tells
export function resolveListedSuites(files, script) {
    const pattern = /--testPathPatterns="([^"]+)"/.exec(script)?.[1];
    if (pattern == undefined) {
        return undefined;
    }
    const matches = new RegExp(pattern);
    const packagePrefix = 'packages/zibri/';
    return files
        .filter(file => file.startsWith(packagePrefix) && matches.test(file))
        .map(file => file.slice(packagePrefix.length))
        .sort();
}

// against the suites of the checkout: a group naming a suite that is gone would compare nothing, and
// one named twice would be compared on two runners
export function validateGroups(groups, suites) {
    const named = Object.values(groups).flatMap(group => group.suites);
    const problems = [
        ...named.filter(suite => !suites.includes(suite)).map(suite => `"${suite}" is no benchmark suite of this checkout`),
        ...named.filter((suite, index) => named.indexOf(suite) !== index).map(suite => `"${suite}" is in more than one group`),
        ...Object.hasOwn(groups, REST_GROUP) ? [`"${REST_GROUP}" is the group of every suite no other group names`] : [],
        ...Object.entries(groups)
            .filter(([, group]) => group.rounds != undefined && (!Number.isInteger(group.rounds) || group.rounds < 1))
            .map(([name, group]) => `the rounds of "${name}" need to be a whole number of at least 1, not ${group.rounds}`),
        ...Object.entries(groups)
            .filter(([, group]) => group.narrowed != undefined && !isNarrowing(group.narrowed))
            .map(([name]) => `the narrowed rounds of "${name}" need to be { rounds, env }: a whole number of at least 1, `
                + 'and at least one environment variable, each a string')
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

// what each run of a side's suites took, in the order they ran: where the time of the job went
const runs = [];

// taken is [{ label, suites, seconds }], the suites as paths relative to the package
export function resolveRunsTable(taken) {
    return [
        '| run | suites | took |',
        '|---|---|---|',
        ...taken.map(ran => `| ${ran.label} | ${ran.suites.map(suite => path.posix.basename(suite)).join(', ')} | ${ran.seconds} s |`)
    ].join('\n');
}

// the environment a side's suites are run in, from the one the comparison was started in: without
// recording a baseline, without the live phases unless they are measured, with the thresholds of the
// allocator set, and with what a narrowed round of the group narrows it with
export function resolveRunEnvironment(startedIn, measureHeld, narrowedWith = {}) {
    const env = { ...startedIn, ...ALLOCATOR_ENV, ...narrowedWith };
    delete env.ZIBRI_BENCHMARK_UPDATE_BASELINE;
    if (!measureHeld) {
        env[SKIP_HELD_MEMORY_ENV] = '1';
    }
    return env;
}

// an empty list runs nothing, for a side without any suite of the group, or none left to run in a round
function runSuites(root, script, suites, measureHeld, label, narrowedWith = {}) {
    if (suites.length === 0) {
        return { values: {}, units: {}, slacks: {} };
    }
    const reportsDir = reportsDirOf(root);
    // a report an earlier run left behind would be read as this one's
    for (const name of reportsIn(reportsDir)) {
        rmSync(path.join(reportsDir, name));
    }
    // by path rather than by another pattern, which jest would match in addition to the script's own:
    // the paths are all it runs, whatever the script names
    const selection = ['--', '--runTestsByPath', ...suites.map(suite => path.join(root, 'packages', 'zibri', suite))];
    const startedAt = Date.now();
    run('npm', ['run', script, '-w', 'zibri', ...selection], root, resolveRunEnvironment(process.env, measureHeld, narrowedWith));
    runs.push({ label, suites, seconds: Math.round((Date.now() - startedAt) / 1000) });

    return resolveRound(reportsIn(reportsDir).map(name => JSON.parse(readFileSync(path.join(reportsDir, name), 'utf8'))));
}

// the files of a ref, as paths relative to the repository
function listFilesAt(ref) {
    return execFileSync('git', ['ls-tree', '-r', '--name-only', ref, '--', 'packages/zibri/src'], { cwd: repoRoot, encoding: 'utf8' })
        .split(/\r?\n/)
        .filter(Boolean);
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
    const checkoutSuites = listSuites(repoRoot, script);
    if (group != undefined) {
        validateGroups(groups, checkoutSuites);
    }
    // the suites of the group among those a side has, every suite without one
    const ofGroup = suites => group == undefined ? suites : resolveGroupSuites(groups, group, suites);
    const currentSuites = ofGroup(checkoutSuites);
    if (manifest?.scripts?.[script] == undefined) {
        write(`${against} runs no "${script}", so there is nothing to compare with yet.`);
        // written all the same, so that the summary of the groups finds one of each
        writeComparison(group, { releaseVersion: manifest?.version, rows: [], failed: false }, {});
        return;
    }
    // what is compared, written, and what fails the job. The allowances that no longer apply only once
    // every suite was compared, which the summary of the groups does
    const conclude = (releaseRounds, currentRounds) => {
        const units = Object.assign({}, ...currentRounds.map(round => round.units));
        // of the checkout, as the units are: what a figure is held to is said by the code that is judged
        const slacks = Object.assign({}, ...currentRounds.map(round => round.slacks));
        const comparison = resolveComparison(
            releaseRounds.map(round => round.values),
            currentRounds.map(round => round.values),
            readAllowances(),
            manifest.version,
            units,
            slacks
        );
        writeComparison(group, comparison, units);
        const staleAllowances = group == undefined ? resolveStaleAllowances(readAllowances(), comparison.rows, manifest.version) : [];
        write(resolveTable(comparison, units, staleAllowances));
        write(resolveRunsTable(runs));
        if (comparison.failed) {
            process.exitCode = 1;
        }
    };

    // asked before the release is installed and built, which takes minutes: with none of the suites on
    // it, those of the checkout are compared with nothing, and run once for the checks of their own
    const listedOnRelease = resolveListedSuites(listFilesAt(against), manifest.scripts[script]);
    if (listedOnRelease != undefined && ofGroup(listedOnRelease).length === 0) {
        conclude([], [runSuites(repoRoot, script, currentSuites, true, 'this checkout, which alone has the suites')]);
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
        const releaseSuites = ofGroup(listSuites(worktree, script));
        const releaseRounds = [];
        const currentRounds = [];
        for (const [round, narrowedWith] of resolveRoundEnvironments(groups, group).entries()) {
            const suites = resolveRoundSuites(currentSuites, releaseSuites, round);
            const narrowed = Object.keys(narrowedWith).length > 0 ? ', narrowed' : '';
            // the release first every other round, so that a machine slowing down or speeding up over
            // the run weighs on both sides alike
            const sides = [
                [worktree, suites.release, releaseRounds, false, `round ${round + 1}, release${narrowed}`],
                [repoRoot, suites.current, currentRounds, round === 0, `round ${round + 1}, this checkout${narrowed}`]
            ];
            for (const [root, ofSide, rounds, measureHeld, label] of round % 2 === 0 ? sides : sides.reverse()) {
                rounds.push(runSuites(root, script, ofSide, measureHeld, label, narrowedWith));
            }
        }
        conclude(releaseRounds, currentRounds);
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