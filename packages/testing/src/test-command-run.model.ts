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
    log: string[]
};