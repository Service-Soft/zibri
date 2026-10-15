import cron, { ScheduledTask } from 'node-cron';

import { type CronExpressionString } from './cron-expression.utilities';
import { CreateCronJobEntityData, CronJobEntity, CronJobState } from './cron-job-entity.model';
import { CronUpdateData } from './cron.service';
import { ShouldRunExecution } from './should-run-execution.type';
import { Repository } from '../data-source/repository/repository';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { ErrorUtilities } from '../error-handling/error.utilities';
import { InternalError } from '../error-handling/internal-error.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { TraceSpanStatus } from '../tracing/trace-span-status.enum';
import { TracingUtilities } from '../tracing/tracing.utilities';
import { OmitStrict } from '../types/omit-strict.type';
import { Ms } from '../utilities/ms';
import { UUIDUtilities } from '../utilities/uuid.utilities';

/**
 * The full initial configuration of a cron job.
 */
export type CronConfig = OmitStrict<CronJobEntity, 'id' | 'lastRun' | 'errorMessage' | 'state' | 'previousState'> & {
    /**
     * Whether the job starts out on the schedule. Defaults to true.
     *
     * Only says where the job begins. What it is doing later is the job's {@link CronJobState}, which
     * an operator changes through the cron service and which a failure can change on its own - none
     * of which belongs in a class that is read once per boot.
     */
    active: boolean,
    /**
     * Whether or not the cron job should be synced to a data source. (With status, lastRun etc.).
     * Defaults to true.
     */
    syncToDataSource: boolean,
    /**
     * Whether this job is work the deployment owes once, or work each instance owes for itself.
     * Defaults to true, meaning once.
     *
     * True is right for almost everything: billing runs, reminder mails, cleaning up rows in a
     * shared data source. Every instance competes for each scheduled execution and exactly one wins,
     * so three replicas do not bill every customer three times.
     *
     * Set it to false only when the job acts on state that belongs to the instance itself and
     * nothing else can see - collecting this process's metrics, or clearing this container's temp
     * folder. Those have to run everywhere, and electing one instance would silently leave the
     * others uncollected or filling up.
     */
    distributed: boolean
};

/**
 * The initial configuration that needs to be provided for a cron job.
 */
export type InitialCronConfig = Partial<CronConfig> & Pick<CronConfig, 'name' | 'cron'>;

/**
 * An error to throw when the cron expression is invalid.
 */
class InvalidCronExpressionError extends InternalError {
    constructor(expression: CronExpressionString) {
        super(`the provided cron expression "${expression}" is not valid.`);
        this.name = 'InvalidCronExpressionError';
    }
}

/**
 * An error to throw when the cron job has not been initialized yet.
 */
class CronJobNotInitializedError extends InternalError {
    constructor() {
        super('the cron job needs to be initialized before it can be used.');
        this.name = 'CronJobNotInitializedError';
    }
}

/**
 * A cron job that run periodically based on the provided cron expression.
 */
export abstract class CronJob {
    /**
     * The initial config of the cron job.
     */
    abstract readonly initialConfig: InitialCronConfig;

    /**
     * The actual cron job entity, fetched either from the db or built locally from the configuration.
     */
    protected entity: CronJobEntity | undefined;

    /**
     * The node cron scheduled task.
     */
    protected task: ScheduledTask | undefined;

    /**
     * Decides whether this instance runs a given execution, so that a job scheduled on every
     * replica still happens once across the deployment.
     */
    protected shouldRunExecution!: ShouldRunExecution;

    /**
     * The repository for syncing cron jobs back and forth to the db.
     */
    protected cronJobRepository!: Repository<CronJobEntity, CreateCronJobEntityData>;

    /**
     * A logger instance.
     */
    protected logger!: LoggerInterface;

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * The full initial config, consisting of the provided config and default values.
     */
    protected get fullInitialConfig(): CronConfig {
        return {
            active: true,
            runOnInit: false,
            syncToDataSource: true,
            stopOnError: false,
            distributed: true,
            // the deployment's answer unless this job has one of its own, which is what lets a single
            // deployment run the same work on the schedule each of its tenants expects
            timezone: inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS).defaultTimezone,
            ...this.initialConfig
        };
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * The name of the cron job.
     */
    get name(): string {
        if (!this.entity) {
            throw new CronJobNotInitializedError();
        }
        return this.entity.name;
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Whether this job is work the deployment owes once rather than work each instance owes for
     * itself.
     *
     * Unlike name and active this is readable before init, because it comes from the job's own
     * configuration rather than from the persisted entity - the cron service needs it to decide
     * whether the deployment has anything to coordinate at all.
     */
    get distributed(): boolean {
        return this.fullInitialConfig.distributed;
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Whether or not the cron job is currently active.
     */
    get active(): boolean {
        return this.state === CronJobState.ACTIVE;
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Whether the cron job is on the schedule, and when it is not, why not.
     */
    get state(): CronJobState {
        if (!this.entity) {
            throw new CronJobNotInitializedError();
        }
        return this.entity.state;
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * When this job last ran, or undefined if it never has.
     */
    get lastRun(): Date | undefined {
        if (!this.entity) {
            throw new CronJobNotInitializedError();
        }
        return this.entity.lastRun ?? undefined;
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * How far back a start looks for a scheduled time this job owed and nothing ran.
     */
    get catchUpWithinMs(): number | undefined {
        if (!this.entity) {
            throw new CronJobNotInitializedError();
        }
        return this.entity.catchUpWithinMs ?? undefined;
    }

    /**
     * Initializes the cron job, without putting it on the schedule yet.
     *
     * Resolving the row and firing the job are deliberately two steps. Registration reads and writes
     * the data source, which has to happen while the app is still coming up. Firing is work, and work
     * should not begin on an instance nothing can reach yet - {@link start} is the second step.
     * @param logger - A logger instance.
     * @param repo - The cron job repository to sync to a data source.
     * @param shouldRunExecution - Decides whether this instance runs a given execution.
     */
    async init(
        logger: LoggerInterface,
        repo: Repository<CronJobEntity, CreateCronJobEntityData>,
        shouldRunExecution: ShouldRunExecution
    ): Promise<void> {
        this.logger = logger;
        this.cronJobRepository = repo;
        this.shouldRunExecution = shouldRunExecution;
        if (this.entity) {
            throw new InternalError('the cron job has already been initialized.');
        }
        if (!cron.validate(this.fullInitialConfig.cron)) {
            throw new InvalidCronExpressionError(this.fullInitialConfig.cron);
        }

        this.entity = await this.resolveEntity();
        this.createTask();
    }

    /**
     * Puts the cron job on the schedule, and performs its startup run if it asked for one.
     *
     * Called once the app is accepting requests. A job that is not active does nothing here, which is
     * how a job somebody disabled stays disabled across a restart.
     */
    async start(): Promise<void> {
        if (!this.entity || !this.task) {
            throw new CronJobNotInitializedError();
        }
        if (this.entity.state !== CronJobState.ACTIVE) {
            return;
        }

        if (this.entity.runOnInit && await this.claimsStartupRun()) {
            await this.task.execute();
        }
        await this.resume();
    }

    /**
     * Puts the job back on the schedule, without the startup run.
     *
     * What a job needs after its task has been rebuilt, which happens whenever its configuration
     * changes while the app is running. A startup run belongs to a start; repeating it every time
     * somebody edits a schedule would fire the job for the edit.
     */
    protected async resume(): Promise<void> {
        if (!this.entity || !this.task) {
            throw new CronJobNotInitializedError();
        }
        if (this.entity.state !== CronJobState.ACTIVE) {
            return;
        }
        await this.task.start();
    }

    /**
     * Whether this job's schedule names the given moment.
     *
     * The task's own matcher, so nothing asking this can disagree with the schedule about what a slot
     * is - including which time zone it is read in.
     * @param date - The moment to check.
     * @returns True if the schedule fires then.
     * @throws When the cron job has not been initialized yet.
     */
    matches(date: Date): boolean {
        if (!this.task) {
            throw new CronJobNotInitializedError();
        }
        return this.task.match(date);
    }

    /**
     * Shuts down the cron job.
     * Should be called from the cron service BeforeAppShutdown hook.
     */
    async shutdown(): Promise<void> {
        await this.task?.stop();
    }

    /**
     * Builds the node cron task, without starting it.
     * @throws When the cron job has not been initialized yet.
     */
    protected createTask(): void {
        if (!this.entity) {
            throw new CronJobNotInitializedError();
        }
        this.task = cron.createTask(this.entity.cron, this.runOnTick.bind(this), {
            maxRandomDelay: Ms.SECOND,
            // without this the expression is read in whatever zone the machine is set to, so the same
            // schedule fires at a different moment on a laptop than in production, and moves by an
            // hour twice a year anywhere that observes daylight saving
            timezone: this.entity.timezone,
            // `distributed` requires a name: node-cron builds the coordination key from it as
            // `<name>:<scheduled time>`, which is what makes every replica compete for the same
            // execution instead of each quietly running its own.
            name: this.entity.name,
            distributed: this.fullInitialConfig.distributed,
            distributedLease: inject(ZIBRI_DI_TOKENS.CRON_EXECUTION_LEASE_IN_MS),
            runCoordinator: { shouldRun: (key: string, ttlMs: number) => this.shouldRunExecution(key, ttlMs) }
        });
    }

    /**
     * Decides whether this instance is the one that performs the startup run.
     *
     * A startup run is not a slot on the schedule, so there is no scheduled time for the replicas to
     * agree on and `task.execute` runs whatever it is given without asking anybody. What they can all
     * agree on is the slot that is coming: every instance of a rolling deploy computes the same next
     * fire time, so that is what the claim is keyed on. An instance restarting a week later sees a
     * different one and runs again, which is the point of the option.
     *
     * Keyed apart from the scheduled execution deliberately. The startup run happens *ahead of* the
     * next slot rather than instead of it, so taking that slot's key here would silently cancel it.
     * @returns Whether to run. Always true for a job each instance owes for itself.
     */
    protected async claimsStartupRun(): Promise<boolean> {
        if (!this.entity || !this.task) {
            throw new CronJobNotInitializedError();
        }
        if (!this.fullInitialConfig.distributed) {
            return true;
        }

        // `getNextRuns` rather than `getNextRun`, which answers null for a task that is not on the
        // schedule yet - and the startup run happens before the task is started, so that is every
        // single time. Both read the same matcher, so the slot they name is the same one.
        const [nextRun] = this.task.getNextRuns(1);
        if (nextRun == undefined) {
            // no slot to key on means nothing for the instances to agree on. Refusing here would
            // drop the run entirely, so it falls back to what a job nobody coordinates does
            return true;
        }

        // held until the slot it names, because that is how long the key means anything: an
        // instance booting after the slot computes the next one and has a key of its own. Held for
        // the execution lease alone, the claim ran out in minutes, and every instance a slow rolling
        // deploy started after that won the same key again and repeated the run. Never less than the
        // execution lease, so a slot a moment away does not make a claim that lapses on arrival.
        const untilSlotInMs: number = nextRun.getTime() - Date.now();
        return await this.shouldRunExecution(
            `${this.entity.name}:startup:${nextRun.toISOString()}`,
            Math.max(untilSlotInMs, inject(ZIBRI_DI_TOKENS.CRON_EXECUTION_LEASE_IN_MS))
        );
    }

    /**
     * Resolves the cron job entity, either from the db or from the local data.
     * @returns The cron job entity.
     */
    protected async resolveEntity(): Promise<CronJobEntity> {
        // distributed is a property of the job rather than of the row, so it is read off the config
        // wherever it is needed rather than stored and read back
        // eslint-disable-next-line unusedImports/no-unused-vars
        const { active, syncToDataSource, distributed, ...persisted } = this.fullInitialConfig;
        const initial: CreateCronJobEntityData = {
            ...persisted,
            state: active ? CronJobState.ACTIVE : CronJobState.INACTIVE,
            previousState: undefined,
            lastRun: undefined,
            errorMessage: undefined
        };

        if (!syncToDataSource) {
            return { id: UUIDUtilities.generate(), ...initial };
        }
        const existing: CronJobEntity | undefined = await this.cronJobRepository.findOne({
            where: { name: this.fullInitialConfig.name },
            required: false
        });
        if (!existing) {
            return await this.cronJobRepository.create(initial);
        }
        return await this.reconcileOnBoot(existing);
    }

    /**
     * Brings a stored row back in line with the job as it is declared today, and undoes what the
     * framework itself took away.
     *
     * Two things happen here, both of them because a restart is the moment where the reasons a job
     * was left the way it was may no longer hold.
     *
     * Everything the cron service offers no way to change is the developer's answer and lives in the
     * class, so the row holds a copy of it rather than the truth about it. Without this the
     * declaration is only ever read the first time the job is seen, and editing it afterwards changes
     * nothing anywhere: the deployment that has been running longest is the one that keeps the
     * behavior its author has since decided against.
     *
     * That is the whole line - a value an operator can change at runtime is theirs, and the rest is
     * the code's. `cron` and the state have `changeCron`, `enable` and `disable`; `runOnInit`,
     * `stopOnError`, `timezone` and `catchUpWithinMs` have nothing, so they come back from the class.
     *
     * A `previousState` is then a job the framework stopped, and the restart is the retry - the
     * deploy, the failover or the configuration change that made this boot happen is the same class
     * of event as the one that would have fixed it. `errorMessage` survives so the failure is still
     * readable afterwards.
     *
     * `cron` and the state an operator chose are therefore left exactly as they are: taking those
     * back on every boot would undo the change the moment anything restarted.
     * @param entity - The row as it is stored.
     * @returns The row, reconciled.
     */
    protected async reconcileOnBoot(entity: CronJobEntity): Promise<CronJobEntity> {
        const { runOnInit, stopOnError, timezone } = this.fullInitialConfig;
        const catchUpWithinMs: number | undefined = this.fullInitialConfig.catchUpWithinMs ?? undefined;
        const state: CronJobState = entity.previousState ?? entity.state;

        if (
            entity.runOnInit === runOnInit
            && entity.stopOnError === stopOnError
            && entity.timezone === timezone
            && (entity.catchUpWithinMs ?? undefined) === catchUpWithinMs
            && entity.state === state
            && entity.previousState == undefined
        ) {
            return entity;
        }

        const reconciled: Pick<
            CronJobEntity,
            'runOnInit' | 'stopOnError' | 'timezone' | 'catchUpWithinMs' | 'state' | 'previousState'
        > = {
            runOnInit,
            stopOnError,
            timezone,
            catchUpWithinMs,
            state,
            // null rather than undefined, because a write only carries the properties it names and
            // undefined names none - the column would keep the state that has just been returned to
            // eslint-disable-next-line unicorn/no-null
            previousState: null
        };
        await this.cronJobRepository.updateAll({ name: entity.name }, reconciled);
        return { ...entity, ...reconciled };
    }

    /**
     * Brings the stored row back in line with what the job class declares about how it behaves.
     *
     * `runOnInit` and `stopOnError` say what the job does, which is the developer's answer and lives
     * in the class - so the row holds a copy of it rather than the truth about it. Without this the
     * declaration is only ever read the first time the job is seen, and editing it afterwards changes
     * nothing anywhere: the deployment that has been running longest is the one that keeps the
     * behavior its author has since decided against.
     *
     * `cron` and `active` are left exactly as they are. Those are what an operator changes at runtime,
     * through the cron service, and taking them back on every boot would undo the change the moment
     * anything restarted.
     * @param entity - The row as it is stored.
     * @returns The row, with the declared behavior applied.
     */
    protected async adoptDeclaredPolicy(entity: CronJobEntity): Promise<CronJobEntity> {
        const { runOnInit, stopOnError } = this.fullInitialConfig;
        if (entity.runOnInit === runOnInit && entity.stopOnError === stopOnError) {
            return entity;
        }

        await this.cronJobRepository.updateAll({ name: entity.name }, { runOnInit, stopOnError });
        return { ...entity, runOnInit, stopOnError };
    }

    /**
     * Runs whenever the cron expression fires.
     * This is a wrapper around this.onTick that takes care of validation, error handling and updating cron job data.
     */
    async runOnTick(): Promise<void> {
        if (!this.entity) {
            throw new CronJobNotInitializedError();
        }

        // held rather than re-read: it is the same object either way, and the narrowing the guard
        // above established does not reach inside the callback
        const entity: CronJobEntity = this.entity;

        // a trace of its own rather than a child of whatever was running: a tick that fired while a
        // request happened to be in flight is not part of that request, and saying it was would make
        // one request look responsible for everything the schedule did
        await TracingUtilities.trace(this.name, { root: true, attributes: { 'code.function': 'onTick' } }, async span => {
            let err: unknown;
            try {
                await this.onTick();
            }
            catch (error) {
                err = error;
            }
            finally {
                entity.lastRun = new Date();
                if (this.fullInitialConfig.syncToDataSource) {
                    await this.cronJobRepository.updateAll({ name: this.fullInitialConfig.name }, { lastRun: entity.lastRun });
                }
            }

            if (err != undefined) {
                // recorded rather than rethrown, because this is where a failed tick is handled -
                // the span still has to say it failed, or a schedule that errors every time looks
                // like one that works
                span.recordError(err);
                span.end(TraceSpanStatus.ERROR);
                await this.runOnError(err);
            }
        });
    }

    /**
     * Runs whenever the execution of the cron job throws an error.
     * This is a wrapper around this.onError that already provides things like disabling the cron job if it's configured that way and logging the error.
     * @param error - The error that was thrown.
     */
    async runOnError(error: unknown): Promise<void> {
        if (!this.entity) {
            throw new CronJobNotInitializedError();
        }

        this.logger.error(new InternalError(`Error running cron job "${this.name}":`, { cause: error }));

        this.entity.errorMessage = ErrorUtilities.unknownToErrorString(error);
        if (this.entity.stopOnError) {
            this.logger.info(`Stopping cron job "${this.name}" until the next start`);
            await this.stopOnError();
        }
        if (this.fullInitialConfig.syncToDataSource) {
            await this.cronJobRepository.updateAll({ name: this.fullInitialConfig.name }, { errorMessage: this.entity.errorMessage });
        }

        await this.onError(error);
    }

    /**
     * Takes the job off the schedule because a tick threw, recording where to put it back.
     *
     * Separate from {@link disable} because the two mean different things to the next start: this one
     * is the framework's decision and is undone there, while a job somebody turned off stays off.
     */
    protected async stopOnError(): Promise<void> {
        if (!this.entity || !this.task) {
            throw new CronJobNotInitializedError();
        }

        await this.task.stop();
        await this.moveToState(CronJobState.STOPPED_ON_ERROR, this.entity.state);
    }

    /**
     * Records a state change, both on the entity and wherever it is synced to.
     * @param state - The state the job is in from now on.
     * @param previousState - The state to return to on the next start, if any.
     */
    protected async moveToState(state: CronJobState, previousState?: CronJobState): Promise<void> {
        if (!this.entity) {
            throw new CronJobNotInitializedError();
        }

        // null rather than undefined for "nothing to return to": a write carries only the properties
        // it names, so leaving it out would keep whatever the last stop recorded
        this.entity.state = state;
        // eslint-disable-next-line unicorn/no-null
        this.entity.previousState = previousState ?? null;
        if (this.fullInitialConfig.syncToDataSource) {
            await this.cronJobRepository.updateAll(
                { name: this.fullInitialConfig.name },
                { state, previousState: this.entity.previousState }
            );
        }
    }

    /**
     * Enables the cron job.
     */
    async enable(): Promise<void> {
        if (!this.entity || !this.task) {
            throw new CronJobNotInitializedError();
        }

        await this.moveToState(CronJobState.ACTIVE);
        await this.resume();
    }

    /**
     * Disables the cron job.
     *
     * Deliberate, so nothing puts it back: it survives restarts and only {@link enable} undoes it.
     */
    async disable(): Promise<void> {
        if (!this.entity || !this.task) {
            throw new CronJobNotInitializedError();
        }

        await this.task.stop();
        await this.moveToState(CronJobState.INACTIVE);
    }

    /**
     * Changes the cron expression.
     * @param cronExpression - The new cron expression to change to.
     */
    async changeCron(cronExpression: CronExpressionString): Promise<void> {
        if (!this.entity || !this.task) {
            throw new CronJobNotInitializedError();
        }
        if (!cron.validate(cronExpression)) {
            throw new InvalidCronExpressionError(cronExpression);
        }

        this.entity.cron = cronExpression;
        if (this.fullInitialConfig.syncToDataSource) {
            await this.cronJobRepository.updateAll({ name: this.fullInitialConfig.name }, { cron: this.entity.cron });
        }
        await this.task.stop();
        await this.task.destroy();
        this.createTask();
        await this.resume();
    }

    /**
     * Updates the cron jobs.
     * @param data - The data to update the cron job with.
     */
    async update(data: CronUpdateData): Promise<void> {
        if (!this.entity || !this.task) {
            throw new CronJobNotInitializedError();
        }
        this.entity = {
            ...this.entity,
            ...data
        };
        if (this.fullInitialConfig.syncToDataSource) {
            await this.cronJobRepository.updateAll({ name: this.fullInitialConfig.name }, { ...data });
        }
        await this.task.stop();
        await this.task.destroy();
        this.createTask();
        await this.resume();
    }

    /**
     * Method that runs at the end of the runOnError method.
     * At that point, things like status update and automatic disable of the job has already happened.
     * @param error - The error that was thrown.
     */
    // eslint-disable-next-line unusedImports/no-unused-vars
    protected onError(error: unknown): void | Promise<void> {
        // Do nothing
    }

    /**
     * The method that is called on every cron execution.
     */
    abstract onTick(): void | Promise<void>;
}