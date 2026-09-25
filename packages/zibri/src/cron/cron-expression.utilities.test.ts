import { describe, expect, it } from '@jest/globals';

import { CronExpression } from './cron-expression.utilities';

/**
 * The builder produces node-cron's six field form, `second minute hour day month weekday`.
 *
 * Which is why every one of these is about what the *seconds* field ends up as. An expression that
 * says nothing about seconds says "every second", so a schedule built by naming a coarser unit has
 * to floor everything below it - otherwise "every five minutes" is a job that runs sixty times, once
 * a second, during every fifth minute.
 */
describe('CronExpression', () => {

    describe('every', () => {

        it('leaves the seconds field open only when seconds are what was asked for', () => {
            expect(CronExpression.every(1, 'seconds').build()).toBe('* * * * * *');
            expect(CronExpression.every(5, 'seconds').build()).toBe('*/5 * * * * *');
        });

        it('runs once a minute rather than sixty times', () => {
            expect(CronExpression.every(1, 'minutes').build()).toBe('0 * * * * *');
            expect(CronExpression.every(5, 'minutes').build()).toBe('0 */5 * * * *');
        });

        it('runs once an hour rather than every second of it', () => {
            expect(CronExpression.every(1, 'hours').build()).toBe('0 0 * * * *');
            expect(CronExpression.every(2, 'hours').build()).toBe('0 0 */2 * * *');
        });

        it('runs at midnight of every nth day', () => {
            expect(CronExpression.every(3, 'days').build()).toBe('0 0 0 */3 * *');
        });

        it('runs on the first of every nth month, which is a day rather than a zero', () => {
            // the day of month field is one based, so flooring it the way the time fields are
            // floored would produce a value no schedule can match
            expect(CronExpression.every(2, 'months').build()).toBe('0 0 0 1 */2 *');
        });
    });

    describe('modifiers', () => {

        it('keeps the floor when a coarser field is then fixed', () => {
            expect(CronExpression.every(1, 'hours').at(30, 'minutes')
                .build()).toBe('0 30 * * * *');
        });

        it('keeps the floor when a range is applied', () => {
            expect(CronExpression.every(1, 'minutes').between(9, 17, 'hours')
                .build()).toBe('0 * 9-17 * * *');
        });

        it('does not floor a field the caller opened up again', () => {
            // `at` is deliberately able to write any field, including one `every` floored - naming a
            // second is how a caller says which second of the minute they meant
            expect(CronExpression.every(1, 'minutes').at(30, 'seconds')
                .build()).toBe('30 * * * * *');
        });
    });

    describe('the fixed entry points', () => {

        it('floors the same way every does', () => {
            expect(CronExpression.daily().build()).toBe('0 0 0 * * *');
            expect(CronExpression.weekly().build()).toBe('0 0 0 * * 0');
            expect(CronExpression.monthly().build()).toBe('0 0 0 1 * *');
        });

        it('places a daily run at a time of day', () => {
            expect(CronExpression.daily().at(9, 'hours')
                .build()).toBe('0 0 9 * * *');
            expect(CronExpression.daily().at(9, 'hours')
                .at(30, 'minutes')
                .build()).toBe('0 30 9 * * *');
        });

        it('restricts to days of the week', () => {
            expect(CronExpression.weekly().on('Monday')
                .build()).toBe('0 0 0 * * 1');
            expect(CronExpression.daily().on('Monday', 'Wednesday', 'Friday')
                .build()).toBe('0 0 0 * * 1,3,5');
        });

        it('restricts to months', () => {
            expect(CronExpression.monthly().in('March', 'June')
                .build()).toBe('0 0 0 1 3,6 *');
        });
    });

    describe('guardrails', () => {

        it('refuses a range that ends before it starts', () => {
            expect(() => CronExpression.every(1, 'minutes').between(17, 9, 'hours')).toThrow(RangeError);
        });

        it('round-trips an expression it did not build', () => {
            const expression: string = '0 30 9 * * 1';
            expect(CronExpression.fromString(expression)).toBe(expression);
        });

        it('refuses an expression with the wrong number of fields', () => {
            expect(() => CronExpression.fromString('* * * *')).toThrow('Expected 6 fields');
        });
    });
});