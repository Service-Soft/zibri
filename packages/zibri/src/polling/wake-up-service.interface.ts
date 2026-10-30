import { WakeUpListener } from './wake-up-listener.model';
import { DataSourceInterface } from '../data-source/data-sources/data-source.interface';

/**
 * Tells the instances of a deployment that something they look for in a data source changed, so they
 * look now, before their next poll.
 *
 * A wake up carries a topic and nothing else: the state it is about stays in the data source, and a
 * wake up that is lost only means an instance finds the change at its next poll.
 */
export interface WakeUpServiceInterface {
    /**
     * Wakes whoever listens for the topic, on every instance sharing the data source, this one
     * included. On a data source that carries no messages, on this instance only.
     *
     * Never throws: a wake up that could not be sent is logged, and the polls find the change later.
     * @param dataSource - The data source holding what changed.
     * @param topic - What changed.
     */
    wake: (dataSource: DataSourceInterface, topic: string) => Promise<void>,
    /**
     * Wakes whoever listens for the topic on this instance, at the given time. Of several times asked
     * for one topic, the earliest is kept.
     * @param topic - What will be due.
     * @param at - When.
     */
    wakeAt: (topic: string, at: Date) => void,
    /**
     * Starts listening for the wake ups of a topic.
     * @param dataSource - The data source holding what the topic is about.
     * @param topic - The topic.
     * @param onWake - Called at every wake up, besides what {@link WakeUpListener.next} resolves.
     * @returns The listener.
     */
    listen: (dataSource: DataSourceInterface, topic: string, onWake?: () => void) => Promise<WakeUpListener>,
    /**
     * Whether a wake up sent through the data source reaches the other instances.
     * @param dataSource - The data source.
     * @returns True when the data source carries messages between instances.
     */
    reachesOtherInstances: (dataSource: DataSourceInterface) => boolean
}