/**
 * Exits the process gracefully, once everything already written to stdout and stderr has gone out.
 * @param code - The exit code.
 * @returns Never, as this will close the process.
 */
export async function exitGracefully(code: number): Promise<never> {
    process.exitCode = code;
    // an empty write's callback runs once everything queued before it is written - which is the
    // flush this is for. `stream.finished` was the wrong question: it waits for the stream to end,
    // and a running process's stdout never does, so the exit below it was unreachable and anything
    // holding the event loop open (a test runner, a timer) hung the refusal forever
    await Promise.all([process.stdout, process.stderr].map(stream => new Promise<void>(resolve => {
        stream.write('', () => resolve());
    })));
    return process.exit(code);
}