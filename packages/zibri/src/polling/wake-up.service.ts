import { WakeUpListener } from './wake-up-listener.model';
import { WakeUpServiceInterface } from './wake-up-service.interface';
import { DataSourceInterface } from '../data-source/data-sources/data-source.interface';
import { DataSourceSubscription, isPubSubDataSource, PubSubDataSourceInterface } from '../data-source/data-sources/pub-sub-data-source.interface';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { InternalError } from '../error-handling/internal-error.model';
import { OnAppShutdown } from '../global/on-app-shutdown.interface';
import { type LoggerInterface } from '../logging/logger.interface';

/**
 * The channel every wake up is sent on. The topic is the message.
 */
const WAKE_UP_CHANNEL: string = 'zibri.wake-up';

/**
 * The longest a timer waits, in milliseconds. A wake up asked for later fires at this and is early,
 * which costs a poll.
 */
const MAX_TIMER_DELAY_IN_MS: number = (2 ** 31) - 1;

/**
 * A wake up asked for at a time, and the timer that sends it.
 */
type ScheduledWakeUp = {
    /**
     * When, in milliseconds since the epoch.
     */
    atMs: number,
    /**
     * The timer.
     */
    timer: NodeJS.Timeout
};

// one subscription per data source, carrying every topic, rather than one per topic: on postgres a
// subscription is a connection the pool cannot hand out
/**
 * Default implementation of the wake up service. It holds one subscription per data source.
 */
@Injectable({ register: 'onUse' })
export class WakeUpService implements WakeUpServiceInterface, OnAppShutdown {
    private readonly listeners: Map<string, Set<() => void>> = new Map();

    private readonly subscriptions: Map<DataSourceInterface, Promise<DataSourceSubscription | undefined>> = new Map();

    private readonly scheduled: Map<string, ScheduledWakeUp> = new Map();

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async wake(dataSource: DataSourceInterface, topic: string): Promise<void> {
        if (!isPubSubDataSource(dataSource)) {
            this.deliver(topic);
            return;
        }
        try {
            await dataSource.publish(WAKE_UP_CHANNEL, topic);
        }
        catch (error) {
            this.logger.warn(`Could not tell the other instances about "${topic}", their polls find it later`, { error });
            this.deliver(topic);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    wakeAt(topic: string, at: Date): void {
        const atMs: number = at.getTime();
        const existing: ScheduledWakeUp | undefined = this.scheduled.get(topic);
        if (existing != undefined && existing.atMs <= atMs) {
            return;
        }
        if (existing != undefined) {
            clearTimeout(existing.timer);
        }
        const timer: NodeJS.Timeout = setTimeout(
            () => {
                this.scheduled.delete(topic);
                this.deliver(topic);
            },
            Math.min(MAX_TIMER_DELAY_IN_MS, Math.max(0, atMs - Date.now()))
        );
        // a wake up is never a reason to keep the process alive
        timer.unref();
        this.scheduled.set(topic, { atMs, timer });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async listen(dataSource: DataSourceInterface, topic: string, onWake?: () => void): Promise<WakeUpListener> {
        if (isPubSubDataSource(dataSource)) {
            await this.resolveSubscription(dataSource);
        }

        let woken: boolean = false;
        let endWait: (() => void) | undefined = undefined;
        const listener: () => void = () => {
            woken = true;
            endWait?.();
            onWake?.();
        };
        const listeners: Set<() => void> = this.listeners.get(topic) ?? new Set();
        listeners.add(listener);
        this.listeners.set(topic, listeners);

        return {
            next: async (timeoutInMs: number, signal?: AbortSignal) => {
                if (!woken && signal?.aborted !== true) {
                    let timer: NodeJS.Timeout | undefined = undefined;
                    await new Promise<void>(resolve => {
                        endWait = resolve;
                        timer = setTimeout(resolve, timeoutInMs);
                        signal?.addEventListener('abort', () => resolve(), { once: true });
                    });
                    clearTimeout(timer);
                    endWait = undefined;
                }
                const wasWoken: boolean = woken;
                woken = false;
                return wasWoken;
            },
            stop: () => {
                listeners.delete(listener);
                endWait?.();
            }
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    reachesOtherInstances(dataSource: DataSourceInterface): boolean {
        return isPubSubDataSource(dataSource);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppShutdown(): Promise<void> {
        for (const { timer } of this.scheduled.values()) {
            clearTimeout(timer);
        }
        this.scheduled.clear();
        const subscriptions: Promise<DataSourceSubscription | undefined>[] = [...this.subscriptions.values()];
        this.subscriptions.clear();
        // before the data sources close, which on postgres waits for the connection a subscription holds
        await Promise.all(subscriptions.map(async s => await (await s)?.unsubscribe()));
    }

    /**
     * The subscription to the wake ups sent through a data source, taken the first time it is needed.
     *
     * A failed one is logged rather than thrown: whoever listens still hears the wake ups of this
     * instance, and the polls find what the others changed.
     * @param dataSource - The data source.
     * @returns The subscription, or undefined when it could not be taken.
     */
    private async resolveSubscription(
        dataSource: DataSourceInterface & PubSubDataSourceInterface
    ): Promise<DataSourceSubscription | undefined> {
        const existing: Promise<DataSourceSubscription | undefined> | undefined = this.subscriptions.get(dataSource);
        if (existing != undefined) {
            return await existing;
        }
        // kept while it is being taken, so listeners arriving together share the one subscription
        const subscribing: Promise<DataSourceSubscription | undefined> = this.subscribe(dataSource);
        this.subscriptions.set(dataSource, subscribing);
        return await subscribing;
    }

    /**
     * Subscribes to the wake ups sent through a data source.
     * @param dataSource - The data source.
     * @returns The subscription, or undefined when it could not be taken.
     */
    private async subscribe(dataSource: DataSourceInterface & PubSubDataSourceInterface): Promise<DataSourceSubscription | undefined> {
        try {
            return await dataSource.subscribe(WAKE_UP_CHANNEL, topic => this.deliver(topic));
        }
        catch (error) {
            this.subscriptions.delete(dataSource);
            this.logger.error(new InternalError(
                'Could not listen for the wake ups of the other instances, their changes are found by the polls',
                { cause: error }
            ));
            return undefined;
        }
    }

    /**
     * Wakes the listeners of a topic on this instance.
     * @param topic - The topic.
     */
    private deliver(topic: string): void {
        for (const listener of this.listeners.get(topic) ?? []) {
            listener();
        }
    }
}