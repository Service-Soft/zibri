import { type AnalyticsSystemModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { AnalyticsOperatingSystem } from './analytics-operating-system.enum';

/**
 * The page views of one operating system, as `GET /systems` of the `AnalyticsController` answers them.
 */
export class AnalyticsSystem implements AnalyticsSystemModel {
    /**
     * The operating system.
     */
    @Property.string({ enum: AnalyticsOperatingSystem })
    operatingSystem!: AnalyticsOperatingSystem;

    /**
     * The page views that came from it.
     */
    @Property.number({ format: 'integer' })
    pageViews!: number;
}