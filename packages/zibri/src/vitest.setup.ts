import { afterEach, beforeAll, beforeEach } from 'vitest';
// eslint-disable-next-line import/no-unassigned-import
import 'reflect-metadata';

import { testVersionsFolder } from './__testing__/constants.ts';
import { FsUtilities } from './utilities/fs.utilities.ts';

/**
 * The uncaught exceptions thrown while the current test ran.
 */
let uncaughtExceptions: Error[] = [];

beforeAll(async () => {
    await FsUtilities.mkdir(testVersionsFolder);
});

// an uncaught exception fails the test it happened in. Left to vitest it fails only the run, credited
// to no test while the test itself passes - and while an application is running its own handler logs
// and rethrows it, which ends the worker and every test left in the file. A capture callback is asked
// instead of every listener, so neither of those runs.
beforeEach(() => {
    uncaughtExceptions = [];
    // oxlint-disable-next-line promise/prefer-await-to-callbacks
    process.setUncaughtExceptionCaptureCallback(error => uncaughtExceptions.push(error));
});

afterEach(() => {
    // oxlint-disable-next-line unicorn/no-null
    process.setUncaughtExceptionCaptureCallback(null);
    const [first, ...rest] = uncaughtExceptions;
    if (first == undefined) {
        return;
    }
    throw rest.length === 0 ? first : new AggregateError(uncaughtExceptions, `${uncaughtExceptions.length} uncaught exceptions`);
});
