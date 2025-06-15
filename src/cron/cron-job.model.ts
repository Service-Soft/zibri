
import cron, { ScheduledTask } from 'node-cron';
import { v4 } from 'uuid';

import { Repository } from '../data-source';
import { inject, repositoryTokenFor, ZIBRI_DI_TOKENS } from '../di';
import { OmitStrict } from '../types';
import { CreateCronJobEntityData, CronJobEntity } from './cron-job-entity.model';
import { unknownToErrorString } from '../error-handling/unknown-to-error-string.function';
import { LoggerInterface } from '../logging';

export type CronConfig = OmitStrict<CronJobEntity, 'id' | 'lastRun' | 'errorMessage'> & { syncToDb: boolean };

export abstract class CronJob {
    abstract readonly config: Partial<CronConfig> & Pick<CronConfig, 'name' | 'cron'>;

    protected entity: CronJobEntity | undefined;

    protected scheduledTask: ScheduledTask | undefined;

    protected readonly cronJobRepository: Repository<CronJobEntity, CreateCronJobEntityData>;
    protected readonly logger: LoggerInterface;

    protected get fullConfig(): CronConfig {
        return {
            active: true,
            runOnInit: true,
            syncToDb: true,
            stopOnError: true,
            ...this.config,
            name: this.overrideName ?? this.config.name
        };
    }

    get name(): string {
        return this.fullConfig.name;
    }

    get task(): ScheduledTask | undefined {
        return this.scheduledTask;
    }

    get active(): boolean {
        if (!this.entity) {
            // eslint-disable-next-line sonar/no-duplicate-string
            throw new Error('the cron job needs to be initialized before it can be used.');
        }
        return this.entity.active;
    }

    constructor(protected readonly overrideName?: string) {
        this.cronJobRepository = inject(repositoryTokenFor(CronJobEntity));
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    async init(): Promise<void> {
        if (this.entity) {
            throw new Error('the cron job has already been initialized.');
        }
        const isValid: boolean = cron.validate(this.fullConfig.cron);
        if (!isValid) {
            throw new Error(`the provided cron expression "${this.fullConfig.cron}" is not valid.`);
        }

        this.entity = await this.resolveEntity();

        this.scheduledTask = cron.createTask(this.fullConfig.cron, this.runOnTick.bind(this), { maxRandomDelay: 1000 });
        if (!this.entity.active) {
            return;
        }
        if (this.entity.runOnInit) {
            await this.scheduledTask.execute();
        }
        await this.scheduledTask.start();
    }

    protected async resolveEntity(): Promise<CronJobEntity> {
        if (!this.fullConfig.syncToDb) {
            return {
                id: v4(),
                lastRun: undefined,
                errorMessage: undefined,
                ...this.fullConfig
            };
        }
        try {
            return await this.cronJobRepository.findOne({ where: { name: this.fullConfig.name } });
        }
        catch {
            return await this.cronJobRepository.create({ ...this.fullConfig, lastRun: undefined, errorMessage: undefined });
        }
    }

    async runOnTick(): Promise<boolean> {
        if (!this.entity) {

            throw new Error('the cron job needs to be initialized before it can be used.');
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
            if (this.fullConfig.syncToDb) {
                await this.cronJobRepository.updateAll({ name: this.fullConfig.name }, { lastRun: this.entity.lastRun });
            }
        }

        if (err != undefined) {
            await this.runOnError(err);
        }

        return false;
    }

    async runOnError(error: unknown): Promise<void> {
        if (!this.entity) {
            throw new Error('the cron job needs to be initialized before it can be used.');
        }

        this.logger.error(`Error running cron job "${this.name}":`);
        this.logger.error(error as Error);

        this.entity.errorMessage = unknownToErrorString(error);
        if (this.entity.stopOnError) {
            this.logger.info(`Stopping cron job "${this.name}"`);
            await this.disable();
        }
        if (this.fullConfig.syncToDb) {
            await this.cronJobRepository.updateAll({ name: this.fullConfig.name }, { errorMessage: this.entity.errorMessage });
        }

        await this.onError(error);
    }

    async enable(): Promise<void> {
        if (!this.entity || !this.task) {
            throw new Error('the cron job needs to be initialized before it can be used.');
        }

        this.entity.active = true;
        if (this.fullConfig.syncToDb) {
            await this.cronJobRepository.updateAll({ name: this.fullConfig.name }, { active: this.entity.active });
        }
        await this.task.start();
    }

    async disable(): Promise<void> {
        if (!this.entity || !this.task) {
            throw new Error('the cron job needs to be initialized before it can be used.');
        }

        this.entity.active = false;
        if (this.fullConfig.syncToDb) {
            await this.cronJobRepository.updateAll({ name: this.fullConfig.name }, { active: this.entity.active });
        }
        await this.task.stop();
    }

    // eslint-disable-next-line unusedImports/no-unused-vars
    onError(error: unknown): void | Promise<void> {
        // Do nothing
    }

    abstract onTick(): void | Promise<void>;
}