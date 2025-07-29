/**
 * Operations you can do on a gauge.
 */
export interface GaugeInterface {
    /**
     *
     */
    increase: (labels?: Record<string, string>, value?: number) => void,
    /**
     *
     */
    decrease: (labels?: Record<string, string>, value?: number) => void,
    /**
     *
     */
    set: (labels: Record<string, string>, value: number) => void
}