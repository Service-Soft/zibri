/**
 * Operations you can do on a gauge.
 */
export interface GaugeInterface {
    /**
     * Increases the value of the gauge.
     */
    increase: (labels?: Record<string, string>, value?: number) => void,
    /**
     * Decreases the value of the gauge.
     */
    decrease: (labels?: Record<string, string>, value?: number) => void,
    /**
     * Sets the value of the gauge.
     */
    set: (labels: Record<string, string>, value: number) => void
}