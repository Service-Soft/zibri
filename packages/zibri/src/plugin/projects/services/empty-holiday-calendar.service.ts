import { Injectable } from '../../../di/decorators/injectable.decorator';
import { type HolidayCalendarInterface } from './holiday-calendar.interface';

/**
 * The holiday calendar of an application that provides none: it knows no calendar, so a working calendar cannot name
 * one.
 */
@Injectable({ register: 'onUse' })
export class EmptyHolidayCalendar implements HolidayCalendarInterface {
    // eslint-disable-next-line jsdoc/require-jsdoc
    async findHolidays(): Promise<Date[] | undefined> {
        return await Promise.resolve(undefined);
    }
}
