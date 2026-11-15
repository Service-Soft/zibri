/* eslint-disable jsdoc/require-jsdoc */
import { readFileSync } from 'node:fs';

// where a process written with `node --cpu-prof` spent its time, summed up by what the code belongs
// to: a package under node_modules, a folder of a workspace's src, or node itself. The way to read a
// profile without opening it in a browser, such as where loading the framework into a process goes.
// `function` as the third argument sums it up by function instead, with the file and line of each.
// `callers` and a function's name as the third and fourth sum up the time spent in it by the calls that
// led there, a few frames each: who allocates what the collector then spends its time on, say.
// Usage: node scripts/summarize-cpu-profile.mjs <file.cpuprofile> [how many rows, 25 by default] [owner | function | callers <name>]

export function resolveOwner(url) {
    if (url === '') {
        return '(native, garbage collection and idle)';
    }
    if (url.startsWith('node:')) {
        return 'node';
    }
    const nodeModules = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(url);
    if (nodeModules != undefined) {
        return nodeModules[1];
    }
    const source = /packages\/([^/]+)\/src\/([^/]+)/.exec(url);
    return source == undefined ? url : `${source[1]}/src/${source[2]}`;
}

// what a sample is summed up under by function: its owner, its name and where it is
export function resolveFunction(callFrame) {
    const file = callFrame.url.split('/').pop() || '(native)';
    return `${resolveOwner(callFrame.url)}  ${callFrame.functionName || '(anonymous)'}  ${file}:${callFrame.lineNumber + 1}`;
}

// self time in milliseconds, by owner or by function
export function resolveSelfTimes(profile, by = 'owner') {
    const ownerOf = new Map(profile.nodes.map(node => [
        node.id,
        by === 'function' ? resolveFunction(node.callFrame) : resolveOwner(node.callFrame.url)
    ]));
    const times = new Map();
    for (const [index, nodeId] of profile.samples.entries()) {
        const owner = ownerOf.get(nodeId) ?? '(unknown)';
        times.set(owner, (times.get(owner) ?? 0) + ((profile.timeDeltas[index] ?? 0) / 1000));
    }
    return times;
}

// how many frames above a function a path of callers names
const CALLER_FRAMES = 6;

// self time in milliseconds of the function of the given name, by the frames that called it
export function resolveCallerTimes(profile, name) {
    const parentOf = new Map(profile.nodes.flatMap(node => (node.children ?? []).map(child => [child, node.id])));
    const nodeOf = new Map(profile.nodes.map(node => [node.id, node]));
    const pathOf = new Map();
    const times = new Map();
    for (const [index, nodeId] of profile.samples.entries()) {
        if (nodeOf.get(nodeId)?.callFrame.functionName !== name) {
            continue;
        }
        if (!pathOf.has(nodeId)) {
            const frames = [];
            for (let id = parentOf.get(nodeId); id != undefined && frames.length < CALLER_FRAMES; id = parentOf.get(id)) {
                frames.push(resolveFunction(nodeOf.get(id).callFrame));
            }
            pathOf.set(nodeId, frames.join('\n             < '));
        }
        const path = pathOf.get(nodeId);
        times.set(path, (times.get(path) ?? 0) + ((profile.timeDeltas[index] ?? 0) / 1000));
    }
    return times;
}

function main() {
    const [file, rows = '25', by = 'owner', name] = process.argv.slice(2);
    const profile = JSON.parse(readFileSync(file, 'utf8'));
    const times = by === 'callers' ? resolveCallerTimes(profile, name) : resolveSelfTimes(profile, by);
    const total = [...times.values()].reduce((sum, ms) => sum + ms, 0);
    const lines = [...times]
        .sort(([, a], [, b]) => b - a)
        .slice(0, Number(rows))
        .map(([owner, ms]) => `${ms.toFixed(0).padStart(8)} ms  ${(ms / total * 100).toFixed(1).padStart(5)} %  ${owner}`);
    process.stdout.write(`${[`${total.toFixed(0).padStart(8)} ms  in all`, ...lines].join('\n')}\n`);
}

main();