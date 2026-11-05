/* eslint-disable jsdoc/require-jsdoc */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// what the benchmark suites measure on this checkout, set against what they measure on the release it
// would replace, failing on an operation that got slower. Both sides are built and run here, in turns,
// so that the machine weighs on both alike - which no recorded number can offer, and which is what
// makes a threshold that fails a build fair. Usage: node scripts/compare-benchmarks.mjs <npm script>,
// against origin/release unless ZIBRI_BENCHMARK_AGAINST names another ref

// how much slower than on the release an operation may be before the comparison fails, unless an
// allowance for that release says otherwise
export const SLOWER_FROM_RATIO = 1.3;

// how often each side runs the suites; the median of the rounds is what is compared
const ROUNDS = 4;

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(packageDir, '..', '..');
// a slowdown found to be worth it: { against, name, ratio, reason }, counting for as long as the
// release `against` is the one compared with
const allowancesPath = path.join(packageDir, 'benchmark-allowances.json');

export function medianOf(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// each round is { [operation]: medianMs }, as one run of the suites reported it
export function resolveComparison(releaseRounds, currentRounds, allowances, releaseVersion) {
    const names = [...new Set(currentRounds.flatMap(round => Object.keys(round)))];
    const rows = names.map(name => {
        const currentMs = medianOf(currentRounds.map(round => round[name]).filter(ms => ms != undefined));
        const releaseTimes = releaseRounds.map(round => round[name]).filter(ms => ms != undefined);
        if (releaseTimes.length === 0) {
            return { name, releaseMs: null, currentMs, ratio: null, limit: null, verdict: 'new' };
        }
        const releaseMs = medianOf(releaseTimes);
        const ratio = currentMs / releaseMs;
        const limit = allowances.find(allowance => allowance.name === name && allowance.against === releaseVersion)?.ratio
            ?? SLOWER_FROM_RATIO;
        return { name, releaseMs, currentMs, ratio, limit, verdict: ratio > limit ? 'slower' : 'ok' };
    });
    // once its release is replaced the slower code is the release, and an operation back within the
    // threshold needs none: either way the allowance would let the next slowdown through unseen
    const staleAllowances = allowances.filter(allowance => {
        const ratio = rows.find(row => row.name === allowance.name)?.ratio;
        return allowance.against !== releaseVersion || ratio == undefined || ratio <= SLOWER_FROM_RATIO;
    });
    return { releaseVersion, rows, staleAllowances, failed: rows.some(row => row.verdict === 'slower') };
}

export function resolveTable(comparison) {
    const format = ms => ms == undefined ? '-' : `${ms.toFixed(3)} ms`;
    const rows = comparison.rows.map(row => {
        const verdict = row.verdict === 'new'
            ? 'not measured on the release'
            : `${row.ratio.toFixed(2)}x, limit ${row.limit}x${row.verdict === 'slower' ? ', **slower**' : ''}`;
        return `| ${row.name} | ${format(row.releaseMs)} | ${format(row.currentMs)} | ${verdict} |`;
    });
    const stale = comparison.staleAllowances
        .map(allowance => `- the allowance for "${allowance.name}" against ${allowance.against} no longer applies: remove it`);
    return [
        `| operation | release ${comparison.releaseVersion} | this checkout | against it |`,
        '|---|---|---|---|',
        ...rows,
        ...stale.length > 0 ? ['', ...stale] : []
    ].join('\n');
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

function runSuites(root, script) {
    const reportsDir = reportsDirOf(root);
    // a report an earlier run left behind would be read as this one's
    for (const name of reportsIn(reportsDir)) {
        rmSync(path.join(reportsDir, name));
    }
    const env = { ...process.env };
    delete env.ZIBRI_BENCHMARK_UPDATE_BASELINE;
    run('npm', ['run', script, '-w', 'zibri'], root, env);

    const timings = {};
    for (const name of reportsIn(reportsDir)) {
        for (const { timing } of JSON.parse(readFileSync(path.join(reportsDir, name), 'utf8'))) {
            if (timings[timing.name] != undefined) {
                throw new Error(`Two benchmarks are named "${timing.name}", so neither can be compared.`);
            }
            timings[timing.name] = timing.medianMs;
        }
    }
    return timings;
}

function main() {
    const [script] = process.argv.slice(2);
    const against = process.env.ZIBRI_BENCHMARK_AGAINST ?? 'origin/release';
    validateRef(against);
    const manifest = readJsonAt(against, 'packages/zibri/package.json');
    if (manifest?.scripts?.[script] == undefined) {
        write(`${against} runs no "${script}", so there is nothing to compare with yet.`);
        return;
    }

    const worktree = mkdtempSync(path.join(os.tmpdir(), 'zibri-benchmark-release-'));
    run('git', ['worktree', 'add', '--detach', worktree, against], repoRoot);
    try {
        // installed and built the way the job builds this checkout
        for (const args of [['ci'], ['run', 'build', '-w', 'zibri-tsx'], ['run', 'build', '-w', 'zibri']]) {
            run('npm', args, worktree);
        }
        const releaseRounds = [];
        const currentRounds = [];
        for (let round = 0; round < ROUNDS; round++) {
            // the release first every other round, so that a machine slowing down or speeding up over
            // the run weighs on both sides alike
            const sides = [[worktree, releaseRounds], [repoRoot, currentRounds]];
            for (const [root, rounds] of round % 2 === 0 ? sides : sides.reverse()) {
                rounds.push(runSuites(root, script));
            }
        }

        const comparison = resolveComparison(releaseRounds, currentRounds, readAllowances(), manifest.version);
        mkdirSync(reportsDirOf(repoRoot), { recursive: true });
        writeFileSync(path.join(reportsDirOf(repoRoot), 'benchmark-comparison.json'), JSON.stringify(comparison, undefined, 4));
        write(resolveTable(comparison));
        if (comparison.failed) {
            process.exitCode = 1;
        }
    }
    finally {
        run('git', ['worktree', 'remove', '--force', worktree], repoRoot);
    }
}

// argv[1] is undefined when this module is imported by a `--eval` script rather than run
if (process.argv[1] != undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main();
}