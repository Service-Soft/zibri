import { type AnalyticsFunnelStepModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { $ts } from '../../../localization/translate.function';
import { ValidateCustom } from '../../../validation/decorators/validate-custom.decorator';
import { AnalyticsLimits } from './analytics-limits.model';

/**
 * One step of a funnel: a page view of a path, or an event of a name. Exactly one of the two.
 */
@ValidateCustom<AnalyticsFunnelStep>(step => (step.path == undefined) === (step.event == undefined)
    ? [{ code: 'pathOrEvent', message: $ts`needs either a path or an event` }]
    : [])
export class AnalyticsFunnelStep implements AnalyticsFunnelStepModel {
    /**
     * The path a page view of the step is of, such as `/takeover`.
     */
    @Property.string({ required: false, maxLength: AnalyticsLimits.PATH_MAX_LENGTH, regex: AnalyticsLimits.PATH_REGEX })
    path?: string;

    /**
     * The name an event of the step has, such as `contact-form-sent`.
     */
    @Property.string({ required: false, minLength: 1, maxLength: AnalyticsLimits.EVENT_NAME_MAX_LENGTH })
    event?: string;
}