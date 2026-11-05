import { type Percentage } from '../../types/percentage.type';

/**
 * What a thread job stored to resume from, with `reportCheckpoint`.
 */
export type ThreadJobCheckpoint<State> = {
    /**
     * How far the job had got when it stored the checkpoint. A run resuming from it starts at this.
     */
    progress: Percentage,
    /**
     * What the job needs to go on from here, as it stored it.
     */
    state: State,
    /**
     * How many checkpoints the job has stored, this one included, counted from its first run.
     */
    number: number
};