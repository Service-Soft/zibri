/**
 * Brings gauges up to date before the metrics are read.
 *
 * Run before a snapshot is collected and before the exposition is resolved, at most once every
 * `minIntervalInMs`. A read in between sees what the last run set.
 */
export type MetricsCollector = {
    /**
     * Names the collector in what is logged when it fails.
     */
    name: string,
    /**
     * The shortest time between two runs, in milliseconds. 0 runs it on every read.
     *
     * `'dataSource'` for a collector that reads the data source: it runs at most once every
     * `ZIBRI_DI_TOKENS.METRICS_DATA_SOURCE_COLLECTOR_INTERVAL_IN_MS`.
     */
    minIntervalInMs: number | 'dataSource',
    /**
     * Sets the gauges. A collector that throws leaves them as the last run set them.
     */
    collect: () => Promise<void>
};