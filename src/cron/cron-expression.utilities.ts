import { IntRange } from '../types/percentage.type';

// eslint-disable-next-line jsdoc/require-jsdoc
type CronUnit = 'seconds' | 'minutes' | 'hours' | 'days' | 'months';

// eslint-disable-next-line jsdoc/require-jsdoc
type DayOfWeek = 'Sunday' | 'Monday' | 'Tuesday' | 'Wednesday'
    | 'Thursday' | 'Friday' | 'Saturday';

// eslint-disable-next-line jsdoc/require-jsdoc
type MonthName = | 'January' | 'February' | 'March' | 'April'
    | 'May' | 'June' | 'July' | 'August'
    | 'September' | 'October' | 'November' | 'December';

// eslint-disable-next-line jsdoc/require-jsdoc
export type CronExpressionString = string & {
    // eslint-disable-next-line jsdoc/require-jsdoc
    __brand: 'CronExpression'
};

// eslint-disable-next-line jsdoc/require-jsdoc
type CronFields = [
    second: string,
    minute: string,
    hour: string,
    day: string,
    month: string,
    weekday: string
];

// eslint-disable-next-line jsdoc/require-jsdoc
type RangeForCronUnit<T extends CronUnit> = T extends 'seconds'
    ? IntRange<0, 60>
    : T extends 'minutes'
        ? IntRange<0, 60>
        : T extends 'hours'
            ? IntRange<0, 24>
            : T extends 'days'
                ? IntRange<1, 32>
                : T extends 'months'
                    ? IntRange<1, 13>
                    : never;

const UNIT_FIELD_INDEX: Record<CronUnit, number> = {
    seconds: 0,
    minutes: 1,
    hours: 2,
    days: 3,
    months: 4
};

const DAY_VALUES: Record<DayOfWeek, number> = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6
};

const MONTH_VALUES: Record<MonthName, number> = {
    January: 1,
    February: 2,
    March: 3,
    April: 4,
    May: 5,
    June: 6,
    July: 7,
    August: 8,
    September: 9,
    October: 10,
    November: 11,
    December: 12
};

// eslint-disable-next-line jsdoc/require-jsdoc
function withField(
    fields: CronFields,
    index: number,
    value: string
): CronFields {
    const next: CronFields = [...fields];
    next[index] = value;
    return next;
}

/**
 * Utility class for creating cron expressions with guardrails.
 */
export class CronExpression {
    private readonly _fields: CronFields;

    private constructor(fields: CronFields) {
        this._fields = fields;
    }

    private static blank(): CronExpression {
        return new CronExpression(['*', '*', '*', '*', '*', '*']);
    }

    // ── Static entry points ──────────────────────────────────────────────────

    /**
     * Runs every N units.
     * @param value - The interval at which to run.
     * @param unit - The unit, like 'minutes', 'hours', 'days' etc.
     * @example
     * CronExpression.every(5, 'minutes')  // "* *\/5 * * * *"
     * CronExpression.every(2, 'hours')    // "* * *\/2 * * *"
     * @returns A cron expression to either continue working with or building the result string.
     */
    static every<T extends CronUnit>(value: RangeForCronUnit<T>, unit: T): CronExpression {
        const idx: number = UNIT_FIELD_INDEX[unit];
        const field: string = value === 1 ? '*' : `*/${value}`;
        return new CronExpression(
            withField(CronExpression.blank()._fields, idx, field)
        );
    }

    /**
     * Runs once a day. Default: midnight (00:00:00).
     * Chain `.at()` to set the time.
     * @example
     * CronExpression.daily().at(9, 'hours').at(30, 'minutes')  // "0 30 9 * * *"
     * @returns A cron expression to either continue working with or building the result string.
     */
    static daily(): CronExpression {
        return new CronExpression(['0', '0', '0', '*', '*', '*']);
    }

    /**
     * Runs once a week. Default: Sunday midnight.
     * Chain `.on()` and `.at()` to customize.
     * @example
     * CronExpression.weekly().on('Monday').at(8, 'hours')  // "0 0 8 * * 1"
     * @returns A cron expression to either continue working with or building the result string.
     */
    static weekly(): CronExpression {
        return new CronExpression(['0', '0', '0', '*', '*', '0']);
    }

    /**
     * Runs once a month. Default: 1st of the month at midnight.
     * @example
     * CronExpression.monthly().at(15, 'days').at(6, 'hours')  // "0 0 6 15 * *"
     * @returns A cron expression to either continue working with or building the result string.
     */
    static monthly(): CronExpression {
        return new CronExpression(['0', '0', '0', '1', '*', '*']);
    }

    /**
     * Builds a CronExpression from a raw node-cron string (for interop / parsing).
     * @param expression - The raw expression too build from.
     * @returns The final CronExpressionString.
     * @throws If there are more than 6 parts provided.
     */
    static fromString(expression: string): CronExpressionString {
        const parts: string[] = expression.trim().split(/\s+/);
        if (parts.length !== 6) {
            throw new Error(
                `Expected 6 fields for node-cron expression, got ${parts.length}: "${expression}"`
            );
        }
        return new CronExpression(parts as CronFields).build();
    }

    // ── Instance modifiers ───────────────────────────────────────────────────

    /**
     * Fixes a specific field to a concrete value.
     * @param value - The concrete value.
     * @param unit - The unit, like 'minutes', 'hours', 'days' etc.
     * @example
     * CronExpression.every(1, 'hours').at(30, 'minutes')  // "* 30 * * * *" (at :30 past every hour)
     * CronExpression.daily().at(9, 'hours')               // "0 0 9 * * *"
     * @returns A cron expression to either continue working with or building the result string.
     */
    at<T extends CronUnit>(value: RangeForCronUnit<T>, unit: T): CronExpression {
        const idx: number = UNIT_FIELD_INDEX[unit];
        return new CronExpression(withField(this._fields, idx, String(value)));
    }

    /**
     * Restricts execution to a range of values for a given unit.
     * @param from - The value at which the range starts.
     * @param to - The value at which the range ends.
     * @param unit - The unit, like 'minutes', 'hours', 'days' etc.
     * @example
     * CronExpression.every(1, 'minutes').between(9, 17, 'hours')  // "* * 9-17 * * *" (business hours only)
     * @returns A cron expression to either continue working with or building the result string.
     * @throws If the "from" value is smaller than the "to" value.
     */
    between<T extends CronUnit>(from: RangeForCronUnit<T>, to: RangeForCronUnit<T>, unit: T): CronExpression {
        if (from >= to) {
            throw new RangeError(`'from' (${from}) must be less than 'to' (${to})`);
        }
        const idx: number = UNIT_FIELD_INDEX[unit];
        return new CronExpression(
            withField(this._fields, idx, `${from}-${to}`)
        );
    }

    /**
     * Restricts execution to specific days of the week.
     * @param days - The days on which the execution should happen.
     * @example
     * CronExpression.daily().on('Monday', 'Wednesday', 'Friday')  // "0 0 0 * * 1,3,5"
     * @returns A cron expression to either continue working with or building the result string.
     */
    on(...days: [DayOfWeek, ...DayOfWeek[]]): CronExpression {
        const value: string = days.map(d => DAY_VALUES[d]).join(',');
        return new CronExpression(withField(this._fields, 5, value));
    }

    /**
     * Restricts execution to specific months.
     * @param months - The months in which the execution should happen.
     * @example
     * CronExpression.monthly().in('March', 'June', 'September', 'December')  // "0 0 0 1 3,6,9,12 *"
     * @returns A cron expression to either continue working with or building the result string.
     */
    in(...months: [MonthName, ...MonthName[]]): CronExpression {
        const value: string = months.map(m => MONTH_VALUES[m]).join(',');
        return new CronExpression(withField(this._fields, 4, value));
    }

    // ── Output ───────────────────────────────────────────────────────────────

    /**
     * Builds the final result from the builder input.
     * @returns The branded node-cron expression string.
     */
    build(): CronExpressionString {
        return this._fields.join(' ') as CronExpressionString;
    }
}