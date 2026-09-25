/**
 * Where a middleware sits in the request pipeline.
 *
 * A phase is a position rather than a moment: everything registered with `app.use` is collected and
 * mounted in one pass when the application starts, so what decides the order is the phase a
 * middleware names and, within one phase, the order the calls were made in. When a middleware is
 * registered - from the constructor, from a lifecycle hook, or from your own code before `start` -
 * changes nothing about where it ends up.
 *
 * The values run in ascending order, which is also the order they are written in below.
 */
export enum MiddlewarePhase {
    /**
     * Answers preflights, marks responses as cross origin readable, puts every request into a
     * trace, encodes what is written back, and sets the security headers.
     *
     * Ahead of everything that can answer a request, because a response no browser will read is one
     * no handler can fix, and an encoder has to take over how a body is written before anything has
     * started writing one.
     */
    SECURITY = 0,
    /**
     * Turns what arrived into values the rest of the pipeline can read - cookies, signed and
     * unsigned.
     *
     * A body is parsed per route rather than here, because what a route accepts is part of what it
     * declares.
     */
    PARSING = 1,
    /**
     * Records that the request happened and how long it took.
     *
     * Around everything below it, so that what is measured is the whole of the work rather than the
     * part that runs after whatever a project added.
     */
    OBSERVABILITY = 2,
    /**
     * Anything that runs before a route is matched, and where your own middleware goes unless it
     * says otherwise.
     *
     * Cookies are parsed and the request is already being timed, so this is the first place a
     * middleware can read what the caller sent and refuse the request outright.
     */
    BEFORE_ROUTING = 3,
    /**
     * Serves static assets and dispatches to controllers.
     */
    ROUTING = 4,
    /**
     * Runs when nothing above answered, which is where a request for something that does not exist
     * becomes a 404.
     *
     * The last phase. What turns an error into a response comes after every one of these and is not
     * registered here: an application has exactly one error handler, and it is named by
     * `ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER`.
     */
    AFTER_ROUTING = 5
}