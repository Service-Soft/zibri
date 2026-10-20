import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { $f } from './format.function.ts';
import { initDiContainer } from '../di/init-di-container.function.ts';
import { AppState } from '../global/app-state.enum.ts';
import { GlobalRegistry } from '../global/global-registry.ts';

describe('$f', () => {
    beforeAll(() => {
        initDiContainer();
    });

    afterEach(() => {
        (GlobalRegistry as unknown as { appData: { state: AppState } })['appData'].state = AppState.OFFLINE;
    });

    describe('while the app is offline', () => {
        it('throws for date()', () => {
            expect(() => $f.date(new Date())).toThrow(/still offline/);
        });

        it('throws for time()', () => {
            expect(() => $f.time(new Date())).toThrow(/still offline/);
        });

        it('throws for dateTime()', () => {
            expect(() => $f.dateTime(new Date())).toThrow(/still offline/);
        });

        it('throws for price()', () => {
            expect(() => $f.price(10, 'USD')).toThrow(/still offline/);
        });

        it('throws for percent()', () => {
            expect(() => $f.percent(0.5)).toThrow(/still offline/);
        });
    });

    describe('once the app is created', () => {
        beforeEach(() => {
            GlobalRegistry.markAppAsCreated();
        });

        it('formats a date using the default locale and time zone', () => {
            const result: string = $f.date(new Date(Date.UTC(2024, 0, 15, 12)));
            expect(result).toBe('01/15/2024');
        });

        it('formats a price using the given currency', () => {
            const result: string = $f.price(1234.5, 'USD');
            expect(result).toContain('1,234.5');
        });

        it('formats a percentage', () => {
            const result: string = $f.percent(0.5);
            expect(result).toContain('50');
        });
    });
});