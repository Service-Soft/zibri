import assert from 'node:assert';

import { FsUtilities } from '../encapsulation';
import { getPath, Path } from '../utilities';

/**
 * A line of npm's debug log that reports a warning or an error, without the counter it starts with.
 * The log holds every level, whatever npm printed, so it is read rather than the output.
 */
const PROBLEM_LINE: RegExp = /^\d+ ((?:warn|error) .*)$/;

/**
 * The line of npm's debug log that names the arguments the command was run with.
 */
const ARGV_LINE: RegExp = /^\d+ verbose argv (.*)$/;

/**
 * Runs something, and finds every warning and error npm reported while it ran.
 *
 * Read from npm's debug logs rather than from what it printed: the cli hands npm the terminal, so its
 * output never reaches the test. Every npm command started below the work writes its log into the
 * given folder, the ones an install script starts included.
 * @param logsDirectory - Where npm writes its logs, a folder of the suite's own.
 * @param work - What runs npm.
 * @returns Each warning and error line, after the npm command that reported it.
 */
export async function resolveNpmProblems(logsDirectory: Path, work: () => Promise<void>): Promise<string[]> {
    await FsUtilities.mkdir(logsDirectory, true, false);
    process.env['npm_config_logs_dir'] = logsDirectory;
    // npm keeps only its ten newest logs otherwise, and an install runs npm again for each install
    // script that calls it
    process.env['npm_config_logs_max'] = '1000';
    try {
        await work();
    }
    finally {
        delete process.env['npm_config_logs_dir'];
        delete process.env['npm_config_logs_max'];
    }
    const logs: string[] = (await FsUtilities.readdir(logsDirectory)).map(entry => entry.name).filter(name => name.endsWith('.log'));
    // otherwise a run whose logs went elsewhere would find no problem, and pass
    assert(logs.length > 0, `npm wrote no log to ${logsDirectory}, so nothing it reported could be read`);
    const problems: string[][] = await Promise.all(logs.map(async name => {
        const lines: string[] = await FsUtilities.readFileLines(getPath(logsDirectory, name));
        const argv: string | undefined = lines.map(line => ARGV_LINE.exec(line)?.[1]).find(match => match != undefined);
        const command: string = `npm ${argv?.replaceAll('"', '') ?? '(unknown)'}`;
        return lines.map(line => PROBLEM_LINE.exec(line)?.[1])
            .filter(problem => problem != undefined)
            .map(problem => `${command}: ${problem}`);
    }));
    return problems.flat();
}