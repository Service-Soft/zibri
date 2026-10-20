/* eslint-disable jsdoc-js/require-jsdoc */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scheduleUrl = 'https://raw.githubusercontent.com/nodejs/Release/main/schedule.json';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function maintainedMajors(schedule, floor, today) {
    return Object.entries(schedule)
        .map(([name, entry]) => ({ major: Number(name.replace('v', '')), entry }))
        .filter(({ major, entry }) => major >= floor && entry.start <= today && today < entry.end)
        .map(({ major }) => major)
        .sort((a, b) => a - b);
}

function declaredFloor() {
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, 'packages', 'zibri', 'package.json'), 'utf8'));
    return Number(/>=\s*(\d+)/.exec(manifest.engines.node)[1]);
}

async function main() {
    const floor = declaredFloor();
    const today = new Date().toISOString();
    let majors;
    try {
        const response = await fetch(scheduleUrl);
        if (!response.ok) {
            throw new Error(`${scheduleUrl} answered ${response.status}`);
        }
        majors = maintainedMajors(await response.json(), floor, today.slice(0, 10));
    }
    catch (error) {
        // github being unreachable is not a reason to test nothing. Falling back to the floor keeps
        // every job below running against the one version every consumer is guaranteed to have.
        process.stderr.write(`could not read the node release schedule, falling back to node ${floor}: ${error}\n`);
        majors = [];
    }
    // the floor is tested whether or not node still maintains it: it is what the packages promise,
    // and the promise outlives the line's support window by however long it takes to raise it.
    if (!majors.includes(floor)) {
        majors.unshift(floor);
    }
    process.stdout.write(`majors=${JSON.stringify(majors.map(String))}\n`);
}

// argv[1] is undefined when this module is imported by a `--eval` script rather than run
if (process.argv[1] != undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}