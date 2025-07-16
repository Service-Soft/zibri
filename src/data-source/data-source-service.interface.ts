/**
 * Interface for a data source service.
 */
export interface DataSourceServiceInterface {
    /**
     * Initializes all data sources.
     */
    init: () => Promise<void>
}