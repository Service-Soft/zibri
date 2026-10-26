/**
 * Runs a scheduled execution on this instance if it is the one that runs it, and holds the claim on
 * the execution for as long as the run lasts.
 *
 * A scheduled job is work the deployment owes once, not once per replica. Every instance reaches
 * this point for every tick and all but one have to be told no, otherwise three pods mean a nightly
 * invoice run bills every customer three times. The claim is renewed underneath the run, so an
 * instance arriving while it runs finds the execution held however long it takes, and it is kept
 * once the run is over, so an instance arriving a moment later does not run it again.
 *
 * Lives in its own file so that a cron job can be handed this capability without knowing about the
 * service that provides it - the same way it is handed a logger and a repository.
 * @param key - Identifies one execution of one job, as `<job name>:<scheduled time>`. Not the job
 * as a whole, so an instance delayed into the next second still competes for the tick it was
 * scheduled for rather than colliding with the following one.
 * @param ttlInMs - How long the claim is held without being renewed before another instance may take
 * the execution over, which is what recovers one whose instance died halfway through.
 * @param run - The execution, run only on the instance that holds the claim.
 * @returns Whether this instance ran it.
 */
export type RunExecution = (key: string, ttlInMs: number, run: () => Promise<void>) => Promise<boolean>;