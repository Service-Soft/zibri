/**
 * A piece of queued work, as the queue runs it: what it knows of the attempts spent on it. Usually a
 * `QueuedWorkEntity`, or something built from one, such as an event and one of its subscribers.
 */
export type QueuedWorkItem = {
    /**
     * How many attempts were spent on it.
     */
    attempts: number
};
