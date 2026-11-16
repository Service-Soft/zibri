/**
 * What running a command of the application on a test server did.
 */
export type TestCommandRun = {
    /**
     * Whether the arguments named a command of the application.
     */
    ran: boolean,
    /**
     * What the application logged at info while it ran the command.
     */
    log: string[],
    /**
     * What the application logged at warn while it ran the command, or while it initialized for
     * arguments that name none.
     */
    warnings: string[]
};