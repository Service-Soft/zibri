
import cron, { ScheduledTask } from 'node-cron';
import { v4 } from 'uuid';

import { Repository } from '../data-source';
import { inject, repositoryTokenFor, ZIBRI_DI_TOKENS } from '../di';
import { OmitStrict } from '../types';
import { CreateCronJobEntityData, CronJobEntity } from './cron-job-entity.model';
import { unknownToErrorString } from '../error-handling/unknown-to-error-string.function';
import { LoggerInterface } from '../logging';
import { CronUpdateData } from './cron.service';

export type CronConfig = OmitStrict<CronJobEntity, 'id' | 'lastRun' | 'errorMessage'> & { syncToDb: boolean };

export abstract class CronJob {
    abstract readonly initialConfig: Partial<CronConfig> & Pick<CronConfig, 'name' | 'cron'>;

    protected entity: CronJobEntity | undefined;

    protected task: ScheduledTask | undefined;

    protected readonly cronJobRepository: Repository<CronJobEntity, CreateCronJobEntityData>;
    protected readonly logger: LoggerInterface;

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

    get name(): string {
        if (!this.entity) {
            // eslint-disable-next-line sonar/no-duplicate-string
            throw new Error('the cron job needs to be initialized before it can be used.');
        }
        return this.entity.name;
    }

    get active(): boolean {
        if (!this.entity) {
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
        if (!cron.validate(this.fullInitialConfig.cron)) {
            throw new Error(`the provided cron expression "${this.fullInitialConfig.cron}" is not valid.`);
        }

        this.entity = await this.resolveEntity();

        await this.initTask();
    }

    protected async initTask(): Promise<void> {
        if (!this.entity) {
            throw new Error('the cron job needs to be initialized before it can be used.');
        }
        this.task = cron.createTask(this.entity.cron, this.runOnTick.bind(this), { maxRandomDelay: 1000 });
        if (!this.entity.active) {
            return;
        }
        if (this.entity.runOnInit) {
            await this.task.execute();
        }
        await this.task.start();
    }

    protected async resolveEntity(): Promise<CronJobEntity> {
        if (!this.fullInitialConfig.syncToDb) {
            return {
                id: v4(),
                lastRun: undefined,
                errorMessage: undefined,
                ...this.fullInitialConfig
            };
        }
        try {
            return await this.cronJobRepository.findOne({ where: { name: this.fullInitialConfig.name } });
        }
        catch {
            return await this.cronJobRepository.create({ ...this.fullInitialConfig, lastRun: undefined, errorMessage: undefined });
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
            if (this.fullInitialConfig.syncToDb) {
                await this.cronJobRepository.updateAll({ name: this.fullInitialConfig.name }, { lastRun: this.entity.lastRun });
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
        if (this.fullInitialConfig.syncToDb) {
            await this.cronJobRepository.updateAll({ name: this.fullInitialConfig.name }, { errorMessage: this.entity.errorMessage });
        }

        await this.onError(error);
    }

    async enable(): Promise<void> {
        if (!this.entity || !this.task) {
            throw new Error('the cron job needs to be initialized before it can be used.');
        }

        this.entity.active = true;
        if (this.fullInitialConfig.syncToDb) {
            await this.cronJobRepository.updateAll({ name: this.fullInitialConfig.name }, { active: this.entity.active });
        }
        await this.task.start();
    }

    async disable(): Promise<void> {
        if (!this.entity || !this.task) {
            throw new Error('the cron job needs to be initialized before it can be used.');
        }

        await this.task.stop();
        this.entity.active = false;
        if (this.fullInitialConfig.syncToDb) {
            await this.cronJobRepository.updateAll({ name: this.fullInitialConfig.name }, { active: this.entity.active });
        }
    }

    async changeCron(cronExpression: string): Promise<void> {
        if (!this.entity || !this.task) {
            throw new Error('the cron job needs to be initialized before it can be used.');
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

    async update(data: CronUpdateData): Promise<void> {
        if (!this.entity || !this.task) {
            throw new Error('the cron job needs to be initialized before it can be used.');
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

    // eslint-disable-next-line unusedImports/no-unused-vars
    onError(error: unknown): void | Promise<void> {
        // Do nothing
    }

    abstract onTick(): void | Promise<void>;
}