import { type CronExpressionString } from './cron-expression.utilities';
import { CreateCronJobEntityData, CronJobEntity, CronJobState } from './cron-job-entity.model';
import { type CronConfig } from './cron-job.model';
import { Repository } from '../data-source/repository/repository';
import { type LoggerInterface } from '../logging/logger.interface';

/**
 * The source of a job declared as a class of the application.
 */
const CODE_SOURCE: string = 'code';

/**
 * Builds the stored row of a cron job, and brings a stored row back in line with the job as its class
 * declares it.
 */
export abstract class CronJobEntityUtilities {
    /**
     * Builds the row of a job as its class declares it.
     * @param config - The job's configuration, with its defaults.
     * @returns The row.
     */
    static resolveInitialEntity(config: CronConfig): CreateCronJobEntityData {
        // runsOn is a property of the job rather than of the row, so it is read off the config
        // wherever it is needed rather than stored and read back

        // and onFailure, which the class owns and every start would take back from it anyway
        // eslint-disable-next-line unusedImports/no-unused-vars
        const { active, syncToDataSource, runsOn, onFailure, ...persisted } = config;
        return {
            ...persisted,
            declaredCron: persisted.cron,
            declaredActive: active,
            source: CODE_SOURCE,
            state: active ? CronJobState.ACTIVE : CronJobState.INACTIVE,
            previousState: undefined,
            consecutiveFailures: 0,
            backedOffUntil: undefined,
            lastRun: undefined,
            errorMessage: undefined
        };
    }

    /**
     * Brings a stored row back in line with the job as it is declared today, and undoes what the
     * framework itself took away.
     * @param entity - The row as it is stored.
     * @param config - The job's configuration, with its defaults.
     * @param repository - Where the row is stored.
     * @param logger - Where a change of the schedule or the state is logged.
     * @returns The row, reconciled.
     */
    static async reconcileOnBoot(
        entity: CronJobEntity,
        config: CronConfig,
        repository: Repository<CronJobEntity, CreateCronJobEntityData>,
        logger: LoggerInterface
    ): Promise<CronJobEntity> {
        // Two things happen here, both of them because a restart is the moment where the reasons a job
        // was left the way it was may no longer hold.
        //
        // Everything the cron service offers no way to change is the developer's answer and lives in
        // the class, so the row holds a copy of it rather than the truth about it. Without this the
        // declaration is only ever read the first time the job is seen, and editing it afterwards
        // changes nothing anywhere: the deployment that has been running longest is the one that keeps
        // the behavior its author has since decided against.
        //
        // `runOnInit`, `timezone` and `catchUpWithinInMs` have no way to change at runtime, so they
        // come back from the class. `onFailure` is not stored at all and is always read from the class.
        //
        // `cron` and the state have `changeCron`, `enable` and `disable`, so both the class and an
        // operator answer them, and the newer answer wins. The row records what the class declared at
        // the last start: a class declaring something else now is a change to the code, which replaces
        // whatever the row holds. A class declaring the same leaves the row's value, so a change made
        // through the cron service survives every restart until the code changes.
        //
        // A `previousState` is then a job the framework stopped, and the restart is the retry - the
        // deploy, the failover or the configuration change that made this boot happen is the same
        // class of event as the one that would have fixed it. `errorMessage` survives so the failure
        // is still readable afterwards.
        const { runOnInit, timezone, cron, active } = config;
        const catchUpWithinInMs: number | undefined = config.catchUpWithinInMs ?? undefined;
        // a row that records no declaration was stored before rows recorded one, so its values may
        // be an operator's change and are kept - the class is followed from this start on.
        //
        // During a rolling deploy an old instance restarting after a new one started takes the old
        // declaration back, and the next new one to start takes it again: the last version to start
        // wins, which is the one left running once the deploy is through.
        const cronChanged: boolean = entity.declaredCron != undefined && entity.declaredCron !== cron;
        const activeChanged: boolean = entity.declaredActive != undefined && entity.declaredActive !== active;
        const declaredState: CronJobState = active ? CronJobState.ACTIVE : CronJobState.INACTIVE;
        const state: CronJobState = activeChanged ? declaredState : entity.previousState ?? entity.state;
        const reconciledCron: CronExpressionString = cronChanged ? cron : entity.cron;

        if (
            entity.runOnInit === runOnInit
            && entity.timezone === timezone
            && (entity.catchUpWithinInMs ?? undefined) === catchUpWithinInMs
            && entity.cron === reconciledCron
            && entity.declaredCron === cron
            && entity.declaredActive === active
            && entity.state === state
            && entity.previousState == undefined
        ) {
            return entity;
        }

        if (entity.cron !== reconciledCron) {
            logger.info(`cron job "${entity.name}": schedule '${entity.cron}' replaced by '${cron}', declared in code`);
        }
        if (activeChanged && entity.state !== state) {
            logger.info(`cron job "${entity.name}": ${active ? 'put on' : 'taken off'} the schedule, declared in code`);
        }

        const reconciled: Pick<
            CronJobEntity,
            'runOnInit' | 'timezone' | 'catchUpWithinInMs' | 'cron' | 'declaredCron' | 'declaredActive' | 'state' | 'previousState'
        > = {
            runOnInit,
            timezone,
            catchUpWithinInMs,
            cron: reconciledCron,
            declaredCron: cron,
            declaredActive: active,
            state,
            // null rather than undefined, because a write only carries the properties it names and
            // undefined names none - the column would keep the state that has just been returned to
            // eslint-disable-next-line unicorn/no-null
            previousState: null
        };
        await repository.updateAll({ name: entity.name }, reconciled);
        return { ...entity, ...reconciled };
    }

    /**
     * Whether a job is declared as a class of the application, rather than stored by itself.
     * @param entity - The job's row.
     * @returns True for a job declared in code.
     */
    static isDeclaredInCode(entity: CronJobEntity): boolean {
        return entity.source === CODE_SOURCE;
    }
}