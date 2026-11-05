/**
 * Runs something without the cli's running commentary.
 *
 * `zi new` names every file it writes, which is exactly right for the person who ran it and is a few
 * hundred lines in front of whatever a suite is reporting. Four suites generate a project, so a
 * failure in any of them arrives buried in the output of the ones that passed.
 *
 * The same move `startTestServer` makes when it silences the logger while it boots: the output is
 * about the thing being set up rather than about the thing being tested.
 * @param work - What to run quietly.
 * @returns Whatever the work returned.
 */
export async function quietly<T>(work: () => Promise<T>): Promise<T> {
    // eslint-disable-next-line no-console
    const log: typeof console.log = console.log;
    // eslint-disable-next-line no-console
    console.log = () => {};
    try {
        return await work();
    }
    finally {
        // eslint-disable-next-line no-console
        console.log = log;
    }
}