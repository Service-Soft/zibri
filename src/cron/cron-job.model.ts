
import cron, { ScheduledTask } from 'node-cron';

import { Repository } from '../data-source';
import { inject, repositoryTokenFor, ZIBRI_DI_TOKENS } from '../di';
import { OmitStrict } from '../types';
import { CreateCronJobEntityData, CronJobEntity } from './cron-job-entity.model';
import { unknownToErrorString } from '../error-handling/unknown-to-error-string.function';
import { LoggerInterface } from '../logging';
import { CronUpdateData } from './cron.service';
import { Ms, UUIDUtilities } from '../utilities';

/**
 * The full initial configuration of a cron job.
 */
export type CronConfig = OmitStrict<CronJobEntity, 'id' | 'lastRun' | 'errorMessage'> & {
    /**
     * Whether or not the cron job should be synced to a database. (With status, lastRun etc.).
     * Defaults to true.
     */
    syncToDb: boolean
};

/**
 * The initial configuration that needs to be provided for a cron job.
 */
export type InitialCronConfig = Partial<CronConfig> & Pick<CronConfig, 'name' | 'cron'>;

const NOT_INITIALIZED_MESSAGE: string = 'the cron job needs to be initialized before it can be used.';

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
     * The repository for syncing cron jobs back and forth to the db.
     */
    protected readonly cronJobRepository: Repository<CronJobEntity, CreateCronJobEntityData>;

    /**
     * A logger instance.
     */
    protected readonly logger: LoggerInterface;

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * The full initial config, consisting of the provided config and default values.
     */
    protected get fullInitialConfig(): CronConfig {
        return {
            active: true,
            runOnInit: true,
            syncToDb: true,
            stopOnError: true,
            ...this.initialConfig,
            name: this.overrideName ?? this.initialConfig.name
        };
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * The name of the cron job.
     */
    get name(): string {
        if (!this.entity) {
            throw new Error(NOT_INITIALIZED_MESSAGE);
        }
        return this.entity.name;
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Whether or not the cron job is currently active.
     */
    get active(): boolean {
        if (!this.entity) {
            throw new Error(NOT_INITIALIZED_MESSAGE);
        }
        return this.entity.active;
    }

    constructor(protected readonly overrideName?: string) {
        this.cronJobRepository = inject(repositoryTokenFor(CronJobEntity));
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    /**
     * Initializes the cron job.
     */
    async init(): Promise<void> {
        if (this.entity) {
            throw new Error('the cron job has already been initialized.');
        }
        if (!cron.validate(this.fullInitialConfig.cron)) {
            throw new Error(`the provided cron expression "${this.fullInitialConfig.cron}" is not valid.`);
        }

        this.entity = await this.resolveEntity();
        await this.initTask();
    }

    /**
     * Initializes the node cron task.
     */
    protected async initTask(): Promise<void> {
        if (!this.entity) {
            throw new Error(NOT_INITIALIZED_MESSAGE);
        }
        this.task = cron.createTask(this.entity.cron, this.runOnTick.bind(this), { maxRandomDelay: Ms.SECOND });
        if (!this.entity.active) {
            return;
        }
        if (this.entity.runOnInit) {
            await this.task.execute();
        }
        await this.task.start();
    }

    /**
     * Resolves the cron job entity, either from the db or from the local data.
     * @returns The cron job entity.
     */
    protected async resolveEntity(): Promise<CronJobEntity> {
        if (!this.fullInitialConfig.syncToDb) {
            return {
                id: UUIDUtilities.generate(),
                lastRun: undefined,
                errorMessage: undefined,
                ...this.fullInitialConfig
            };
        }
        return await this.cronJobRepository.findOne({ where: { name: this.fullInitialConfig.name } }, false)
            ?? await this.cronJobRepository.create({ ...this.fullInitialConfig, lastRun: undefined, errorMessage: undefined });
    }

    /**
     * Runs whenever the cron expression fires.
     * This is a wrapper around this.onTick that takes care of validation, error handling and updating cron job data.
     */
    async runOnTick(): Promise<void> {
        if (!this.entity) {
            throw new Error(NOT_INITIALIZED_MESSAGE);
        }

        let err: unknown;
        try {
            await this.onTick();
        }
        catch (error) {
            err = error;
        }
        finally {
            this.entity.lastRun = new Date();
            if (this.fullInitialConfig.syncToDb) {
                await this.cronJobRepository.updateAll({ name: this.fullInitialConfig.name }, { lastRun: this.entity.lastRun });
            }
        }

        if (err != undefined) {
            await this.runOnError(err);
        }
    }

    /**
     * Runs whenever the execution of the cron job throws an error.
     * This is a wrapper around this.onError that already provides things like disabling the cron job if it's configured that way and logging the error.
     * @param error - The error that was thrown.
     */
    async runOnError(error: unknown): Promise<void> {
        if (!this.entity) {
            throw new Error(NOT_INITIALIZED_MESSAGE);
        }

        await this.logger.error(new Error(`Error running cron job "${this.name}":`, { cause: error }));

        this.entity.errorMessage = unknownToErrorString(error);
        if (this.entity.stopOnError) {
            await this.logger.info(`Stopping cron job "${this.name}"`);
            await this.disable();
        }
        if (this.fullInitialConfig.syncToDb) {
            await this.cronJobRepository.updateAll({ name: this.fullInitialConfig.name }, { errorMessage: this.entity.errorMessage });
        }

        await this.onError(error);
    }

    /**
     * Enables the cron job.
     */
    async enable(): Promise<void> {
        if (!this.entity || !this.task) {
            throw new Error(NOT_INITIALIZED_MESSAGE);
        }

        this.entity.active = true;
        if (this.fullInitialConfig.syncToDb) {
            await this.cronJobRepository.updateAll({ name: this.fullInitialConfig.name }, { active: this.entity.active });
        }
        await this.task.start();
    }

    /**
     * Disables the cron job.
     */
    async disable(): Promise<void> {
        if (!this.entity || !this.task) {
            throw new Error(NOT_INITIALIZED_MESSAGE);
        }

        await this.task.stop();
        this.entity.active = false;
        if (this.fullInitialConfig.syncToDb) {
            await this.cronJobRepository.updateAll({ name: this.fullInitialConfig.name }, { active: this.entity.active });
        }
    }

    /**
     * Changes the cron expression.
     * @param cronExpression - The new cron expression to change to.
     */
    async changeCron(cronExpression: string): Promise<void> {
        if (!this.entity || !this.task) {
            throw new Error(NOT_INITIALIZED_MESSAGE);
        }
        if (!cron.validate(cronExpression)) {
            throw new Error(`the provided cron expression "${cronExpression}" is not valid.`);
        }

        this.entity.cron = cronExpression;
        if (this.fullInitialConfig.syncToDb) {
            await this.cronJobRepository.updateAll({ name: this.fullInitialConfig.name }, { cron: this.entity.cron });
        }
        await this.task.stop();
        await this.task.destroy();
        await this.initTask();
    }

    /**
     * Updates the cron jobs.
     * @param data - The data to update the cron job with.
     */
    async update(data: CronUpdateData): Promise<void> {
        if (!this.entity || !this.task) {
            throw new Error(NOT_INITIALIZED_MESSAGE);
        }
        this.entity = {
            ...this.entity,
            ...data
        };
        if (this.fullInitialConfig.syncToDb) {
            await this.cronJobRepository.updateAll({ name: this.fullInitialConfig.name }, { ...data });
        }
        await this.task.stop();
        await this.task.destroy();
        await this.initTask();
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