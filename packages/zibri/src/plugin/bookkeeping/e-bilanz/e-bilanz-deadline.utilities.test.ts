import { describe, expect, it } from '@jest/globals';

import { EBilanzDeadlineUtilities } from './e-bilanz-deadline.utilities';

function deadline(end: string, taxAdvisor: boolean): string {
    return EBilanzDeadlineUtilities.resolveDeadline(new Date(`${end}T00:00:00.000Z`), taxAdvisor).toISOString()
        .slice(0, 10);
}

describe('the deadline of the E-Bilanz', () => {
    it('is the 31 July of the year after the one the fiscal year ends in, § 149 (2) AO', () => {
        // a Friday
        expect(deadline('2025-12-31', false)).toBe('2026-07-31');
        // a fiscal year from July to June is taxed in the year it ends in, § 7 (4) KStG
        expect(deadline('2025-06-30', false)).toBe('2026-07-31');
    });

    it('is the last day of February of the second year after it with a tax advisor, § 149 (3) AO', () => {
        // the 29th in a leap year, a Tuesday
        expect(deadline('2026-12-31', true)).toBe('2028-02-29');
    });

    it('moves from a Saturday or a Sunday to the Monday after it, § 108 (3) AO', () => {
        // 2027-07-31 is a Saturday, 2027-02-28 a Sunday
        expect(deadline('2026-12-31', false)).toBe('2027-08-02');
        expect(deadline('2025-12-31', true)).toBe('2027-03-01');
    });

    it('is the later one of Art. 97 § 36 (3) EGAO for the years of the pandemic', () => {
        expect(deadline('2024-12-31', true)).toBe('2026-04-30');
        expect(deadline('2024-12-31', false)).toBe('2025-07-31');
        // 2024-08-31 is a Saturday
        expect(deadline('2023-12-31', false)).toBe('2024-09-02');
    });
});