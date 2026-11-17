/**
 * A command of the application, which a process runs in place of starting the application, such as
 * `node dist/bundle.js reset-admin`.
 *
 * The application is initialized for the command, with its data sources connected and its
 * services built, and shut down once the command is done. It does not listen, and runs no cron job,
 * event or thread job.
 */
export type AppCommand = {
    /**
     * The word the command is started with, such as `reset-admin`. It holds no whitespace, does not
     * start with `-`, and is not `migrate`.
     */
    readonly name: string,
    /**
     * What the command does, in one line, for the list of commands an unknown one is answered with.
     */
    readonly description: string,
    /**
     * Runs the command.
     * @param args - The arguments after its name.
     */
    run: (args: string[]) => Promise<void>
};