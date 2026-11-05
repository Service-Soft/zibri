/**
 * One number a built deployment is measured by: the size of something it ships, or how long a step
 * of its start takes.
 */
export type DeploymentMeasurement = {
    /**
     * What was measured.
     */
    name: string,
    /**
     * The value, in `unit`.
     */
    value: number,
    /**
     * What the value counts.
     */
    unit: 'bytes' | 'ms'
};