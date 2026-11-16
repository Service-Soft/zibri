/* eslint-disable jsdoc/require-jsdoc, no-console -- a script, whose summary is what it prints */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// where every thread of a process spends what a benchmark wants looked into: the benchmarks run under `perf`, which
// records what a suite asks for, and each recording is summed up by thread, by library and by function. What a cpu
// profile of node leaves out is in it: the collector's helpers, the thread pool and their native code, zstd and
// OpenSSL among them.
// A suite asks for it in one of two ways:
// - measuring in the process of jest, it wraps what it wants recorded in PerfRecordingUtilities.recordIfAsked: jest
//   runs under perf, with the control in ZIBRI_BENCHMARK_PERF_CONTROL
// - forking the processes it measures, as the backup benchmarks do, it starts them under perf itself, recording into
//   ZIBRI_BENCHMARK_PERF_FOLDER, through PerfRecordingUtilities.createControl, resolveFork and record
// Usage: node scripts/profile-benchmarks.mjs [group | suite.ts…], a group of benchmark-groups.json, `postgres` by
// default, or the paths of suites; node scripts/profile-benchmarks.mjs --summarize <folder> for the recordings of an
// earlier run. Linux only, with perf installed.

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const groupsPath = path.join(packageDir, 'benchmark-groups.json');
const outputFolder = path.join(packageDir, 'src', '__testing__', 'file-output', `benchmark-perf-${randomUUID()}`);
// what perf records with, and node runs with to name its functions: the same for jest here as for a process a suite
// forks, see src/__testing__/benchmark/perf-recording.utilities.ts
const recordOptionsPath = path.join(packageDir, 'src', '__testing__', 'benchmark', 'perf-record-options.json');
const recordOptions = JSON.parse(readFileSync(recordOptionsPath, 'utf8'));
// the recording of jest itself, which a suite measuring in its process enables
const jestRecording = path.join(outputFolder, 'jest.perf.data');

// a perf_event_paranoid above it refuses to record even a process of one's own
const HIGHEST_PARANOID_LEVEL = 2;
// what is left out of a summary, in percent of the samples
const THREAD_LIMIT_PERCENT = '0.5';
const LIBRARY_LIMIT_PERCENT = '1';
const FUNCTION_LIMIT_PERCENT = '0.5';
const MOST_FUNCTIONS = 40;
// what a name is cut to: a C++ template can run on for hundreds of characters after its parameters are gone
const MAX_NAME_LENGTH = 100;
// what perf separates the fields of a report with, which no name of a thread, library or function holds
const FIELD_SEPARATOR = '|';
const SUMMARIZE_FLAG = '--summarize';

function fail(message) {
    console.error(message);
    process.exit(1);
}

function validatePerf() {
    if (process.platform !== 'linux') {
        fail(`perf records on Linux only, this is ${process.platform}.`);
    }
    try {
        execFileSync('perf', ['--version'], { stdio: 'ignore' });
    }
    catch {
        fail([
            'perf is not installed. It comes with the kernel tools of the distribution:',
            '  Arch:          sudo pacman -S perf',
            '  Debian/Ubuntu: sudo apt install linux-perf, or linux-tools-$(uname -r)',
            '  Fedora:        sudo dnf install perf'
        ].join('\n'));
    }
    const paranoid = Number(readFileSync('/proc/sys/kernel/perf_event_paranoid', 'utf8').trim());
    if (paranoid > HIGHEST_PARANOID_LEVEL) {
        fail(`perf_event_paranoid is ${paranoid}, which refuses to record a process at all. Lower it until the next boot with:\n`
            + `  sudo sysctl kernel.perf_event_paranoid=${HIGHEST_PARANOID_LEVEL}`);
    }
    // the events a measured process is recorded with, on a program that ends at once: what perf refuses is refused
    // here rather than after the benchmark booted
    const probe = path.join(outputFolder, 'probe.data');
    try {
        execFileSync('perf', ['record', ...recordOptions.perf, '-o', probe, '--', 'true'], { stdio: ['ignore', 'ignore', 'pipe'] });
    }
    catch (error) {
        fail(`perf refuses to record here:\n${error.stderr?.toString() ?? error.message}`);
    }
}

// the suites named, or those of the group named
function resolveSuites(args) {
    if (args.length && args.every(arg => arg.endsWith('.ts'))) {
        const missing = args.filter(arg => !existsSync(path.resolve(packageDir, arg)));
        if (missing.length) {
            fail(`There is no suite ${missing.join(', ')} in ${packageDir}.`);
        }
        return args;
    }
    const group = args[0] ?? 'postgres';
    const groups = JSON.parse(readFileSync(groupsPath, 'utf8'));
    const suites = groups[group];
    if (!Array.isArray(suites)) {
        fail(`There is no benchmark group "${group}", only ${Object.keys(groups).join(', ')}, or name the paths of suites.`);
    }
    return suites;
}

// the command of `npm run test:benchmark`, with node naming the functions V8 compiled as a recorded process does: run
// here rather than through npm, since node takes none of those from NODE_OPTIONS
function resolveJestCommand(suites) {
    const script = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8')).scripts['test:benchmark'];
    if (typeof script !== 'string' || !script.startsWith('node ')) {
        fail(`The script test:benchmark of package.json is expected to start node, and is: ${script}`);
    }
    const nodeOptions = recordOptions.node.map(option => option.replace('{folder}', outputFolder).replace('{file}', jestRecording));
    // for the shell, which the script of package.json is written for
    const quote = arg => `'${arg.replaceAll('\'', String.raw`'\''`)}'`;
    const suiteArgs = ['--runTestsByPath', ...suites].map(quote);
    return `node ${nodeOptions.map(quote).join(' ')} ${script.slice('node '.length)} ${suiteArgs.join(' ')}`;
}

// jest under perf, recording nothing until a suite enables it through the FIFOs of its control
function runUnderPerf(suites) {
    const control = { file: jestRecording, commands: `${jestRecording}.control`, answers: `${jestRecording}.answers` };
    execFileSync('mkfifo', [control.commands, control.answers]);
    execFileSync(
        'perf',
        [
            'record',
            ...recordOptions.perf,
            '--control',
            `fifo:${control.commands},${control.answers}`,
            '-o',
            control.file,
            '--',
            'sh',
            '-c',
            resolveJestCommand(suites)
        ],
        {
            cwd: packageDir,
            stdio: 'inherit',
            env: {
                ...process.env,
                ZIBRI_BENCHMARK_PERF_CONTROL: JSON.stringify(control),
                ZIBRI_BENCHMARK_PERF_FOLDER: outputFolder,
                // the live phases of the backup benchmarks restore once more, which is no part of what is recorded
                ZIBRI_BENCHMARK_SKIP_HELD_MEMORY: '1'
            }
        }
    );
}

// a function by its name alone: without the marker of where it runs, and without the parameters of a C++ one
function shorten(field) {
    const name = field.replace(/^\[[.k]\] /, '');
    const parameters = name.indexOf('(');
    const shortened = parameters > 0 ? name.slice(0, parameters) : name;
    return shortened.length > MAX_NAME_LENGTH ? `${shortened.slice(0, MAX_NAME_LENGTH - 1)}…` : shortened;
}

// what perf reports, a row of its fields each: the share, then one field for each key it was sorted by. Separated by
// perf rather than laid out, since it pads every column to the longest name, a C++ signature of a few hundred
// characters, and adds columns nothing was asked of
function report(file, sort, limitPercent) {
    const output = execFileSync(
        'perf',
        [
            'report',
            '-i',
            file,
            '--stdio',
            '--no-children',
            '-g',
            'none',
            '--sort',
            sort,
            '--percent-limit',
            limitPercent,
            '-t',
            FIELD_SEPARATOR
        ],
        { cwd: packageDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }
    );
    const keys = sort.split(',').length;
    return output.split('\n')
        .filter(line => line.trim() !== '' && !line.startsWith('#'))
        .map(line => line.split(FIELD_SEPARATOR).slice(0, keys + 1)
            .map(field => shorten(field.trim())));
}

// rows as columns as wide as their widest field, the share right aligned
function format(rows) {
    const widths = rows.reduce((max, row) => row.map((field, i) => Math.max(max[i] ?? 0, field.length)), []);
    return rows.map(row => row.map((field, i) => i === 0 ? field.padStart(widths[i]) : field.padEnd(widths[i]))
        .join('  ')
        .trimEnd())
        .join('\n');
}

// the names of the functions V8 compiled, which each measured process wrote beside its recording: perf report reads
// them from /tmp alone
function publishFunctionNames(folder) {
    for (const name of readdirSync(folder).filter(n => /^perf-\d+\.map$/.test(n))) {
        try {
            copyFileSync(path.join(folder, name), path.join('/tmp', name));
        }
        catch (error) {
            console.log(`${name} could not be copied to /tmp, so the functions of JavaScript show as addresses: ${error.message}`);
        }
    }
}

function print(file, threads) {
    console.log('\nby thread:');
    console.log(format(threads));
    console.log('\nby thread and library:');
    console.log(format(report(file, 'comm,dso', LIBRARY_LIMIT_PERCENT)));
    console.log(`\nby function, the ${MOST_FUNCTIONS} that took most:`);
    console.log(format(report(file, 'comm,symbol', FUNCTION_LIMIT_PERCENT).slice(0, MOST_FUNCTIONS)));
}

// a recording summed up, or nothing for one that holds no samples, such as that of jest when no suite measuring in its
// process asked for one
function summarize(file) {
    let threads;
    try {
        threads = report(file, 'comm', THREAD_LIMIT_PERCENT);
    }
    catch (error) {
        // a process that failed before what it records leaves a recording of nothing, or none perf reads
        console.log(`\n=== ${path.basename(file, '.perf.data')} ===`);
        console.log(`perf could not read the recording: ${error.stderr?.toString().trim() || error.message}`);
        return false;
    }
    if (!threads.length) {
        return false;
    }
    console.log(`\n=== ${path.basename(file, '.perf.data')} ===`);
    print(file, threads);
    return true;
}

// every recording of a folder, summed up
function summarizeFolder(folder) {
    const files = readdirSync(folder).filter(name => name.endsWith('.perf.data'))
        .sort();
    publishFunctionNames(folder);
    const summed = files.filter(name => summarize(path.join(folder, name)));
    if (!summed.length) {
        fail(`Nothing was recorded into ${folder}: no suite run asked for a recording.`);
    }
    console.log(`\nThe recordings are in ${path.relative(process.cwd(), folder)}: perf report -i <file> opens one, `
        + 'node scripts/profile-benchmarks.mjs --summarize <folder> sums them up again.');
}

function main() {
    if (process.argv[2] === SUMMARIZE_FLAG) {
        const folder = process.argv[3];
        if (folder == undefined) {
            fail(`${SUMMARIZE_FLAG} takes the folder of the recordings.`);
        }
        summarizeFolder(path.resolve(folder));
        return;
    }
    const suites = resolveSuites(process.argv.slice(2));
    mkdirSync(outputFolder, { recursive: true });
    validatePerf();

    let failed = false;
    try {
        runUnderPerf(suites);
    }
    catch {
        // summed up all the same: a comparison that failed is often why the recordings are wanted
        failed = true;
    }

    summarizeFolder(outputFolder);
    if (failed) {
        process.exit(1);
    }
}

main();