import { type DataSourceInterface } from './data-sources/data-source.interface';
import { AfterAppShutdown } from '../global/after-app-shutdown.interface';
import { BeforeAppInit } from '../global/before-app-init.interface';

/**
 * Interface for a data source service.
 */
export interface DataSourceServiceInterface extends BeforeAppInit, AfterAppShutdown {
    /**
     * The data sources of the application, once they are initialized.
     */
    getDataSources: () => DataSourceInterface[]
}