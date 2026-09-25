/**
 * Decides whether this instance is the one that runs a given scheduled execution.
 *
 * A scheduled job is work the deployment owes once, not once per replica. Every instance reaches
 * this point for every tick and all but one have to be told no, otherwise three pods mean a nightly
 * invoice run bills every customer three times.
 *
 * Lives in its own file so that a cron job can be handed this capability without knowing about the
 * service that provides it - the same way it is handed a logger and a repository.
 * @param key - Identifies one execution of one job, as `<job name>:<scheduled time>`. Not the job
 * as a whole, so an instance delayed into the next second still competes for the tick it was
 * scheduled for rather than colliding with the following one.
 * @param ttlMs - How long the claim is held before another instance may take it over, which is what
 * recovers an execution whose instance died halfway through.
 * @returns Whether this instance should run it.
 */
export type ShouldRunExecution = (key: string, ttlMs: number) => Promise<boolean>;