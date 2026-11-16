/**
 * Where a `perf` started with a program records it, and the FIFOs the program tells it when to through.
 */
export type PerfControl = {
    /**
     * Where the recording is written, for `perf report -i`.
     */
    file: string,
    /**
     * The FIFO `perf` reads its commands from, such as `enable`.
     */
    commands: string,
    /**
     * The FIFO `perf` answers each command on, with `ack` once it carried it out.
     */
    answers: string
};