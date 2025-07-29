/* eslint-disable typescript/typedef */
// eslint-disable-next-line jsdoc/require-jsdoc
export abstract class Ms {
    /**
     * The amount of ms in a second.
     */
    static SECOND = 1000 as const;
    /**
     * The amount of ms in a minute.
     */
    static MINUTE = 60_000 as const;
    /**
     * The amount of ms in an hour.
     */
    static HOUR = 3_600_000 as const;
    /**
     * The amount of ms in a day.
     */
    static DAY = 86_400_000 as const;
    /**
     * The amount of ms in a week.
     */
    static WEEK = 604_800_000 as const;
}