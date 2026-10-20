import { AfterAppShutdown } from '../global/after-app-shutdown.interface.ts';
import { BeforeAppInit } from '../global/before-app-init.interface.ts';

/**
 * Interface for a data source service.
 */
export interface DataSourceServiceInterface extends BeforeAppInit, AfterAppShutdown {}