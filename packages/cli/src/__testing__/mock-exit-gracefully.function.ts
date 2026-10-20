import { vi, MockInstance } from 'vitest';

import * as exitGracefullyModule from '../utilities/exit-gracefully.function.ts';

/**
 * Thrown by the mocked "exitGracefully" so that code after an exit call stops executing,
 * mirroring how the real "process.exit" halts the process.
 */
export class ProcessExitError extends Error {
    /**
     * Creates the error.
     * @param code - The exit code the process would have exited with.
     */
    constructor(readonly code: number) {
        super(`process would exit with code ${code}`);
        this.name = 'ProcessExitError';
    }
}

/**
 * Mocks "exitGracefully" so tests can assert on cli exit behavior without killing the test process.
 * Every real caller (exitWithError, exitWithInterrupt) awaits this function and treats its result as unreachable,
 * so throwing here faithfully reproduces "nothing after this point runs".
 * @returns The created spy, restored automatically via vi.restoreAllMocks().
 */
export function mockExitGracefully(): MockInstance<typeof exitGracefullyModule.exitGracefully> {
    return vi.spyOn(exitGracefullyModule, 'exitGracefully').mockImplementation((code: number) => {
        throw new ProcessExitError(code);
    });
}