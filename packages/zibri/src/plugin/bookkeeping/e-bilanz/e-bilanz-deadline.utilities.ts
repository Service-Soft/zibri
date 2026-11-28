/**
 * The deadlines extended for the years of the pandemic, Art. 97 § 36 (3) EGAO, by the calendar year taxed: without a
 * tax advisor and with one.
 */
const EXTENDED_DEADLINES: Readonly<Record<number, readonly [string, string]>> = {
    2022: ['2023-09-30', '2024-07-31'],
    2023: ['2024-08-31', '2025-05-31'],
    2024: ['2025-07-31', '2026-04-30']
};

/**
 * The deadline of the E-Bilanz, which is filed with the tax return of the year (§ 5b EStG, § 31 (1a) KStG).
 */
export abstract class EBilanzDeadlineUtilities {
    /**
     * Resolves the last day an E-Bilanz of a fiscal year is filed on: the tax return of a corporation is of the
     * calendar year its fiscal year ends in (§ 7 (4) KStG), due seven months after that year, on 31 July (§ 149 (2)
     * AO), or with a tax advisor on the last day of February of the second year after it (§ 149 (3) AO), the years of
     * Art. 97 § 36 (3) EGAO later. A deadline on a Saturday or a Sunday ends on the Monday after it (§ 108 (3) AO).
     * Public holidays, which differ by state, are not counted, so the day answered is never later than the deadline.
     * A tax office can ask for the return earlier (§ 149 (4) AO).
     * @param end - The last day of the fiscal year, at midnight UTC.
     * @param taxAdvisor - Whether a tax advisor prepares the return.
     * @returns The deadline, at midnight UTC.
     */
    static resolveDeadline(end: Date, taxAdvisor: boolean): Date {
        const year: number = end.getUTCFullYear();
        const extended: readonly [string, string] | undefined = EXTENDED_DEADLINES[year];
        const day: Date = extended == undefined
            ? taxAdvisor
                // the day before the first of March, the 28th or the 29th of February
                ? new Date(Date.UTC(year + 2, 2, 0))
                : new Date(Date.UTC(year + 1, 6, 31))
            : new Date(`${taxAdvisor ? extended[1] : extended[0]}T00:00:00.000Z`);
        const weekday: number = day.getUTCDay();
        const shift: number = weekday === 6 ? 2 : weekday === 0 ? 1 : 0;
        return new Date(day.getTime() + (shift * 86_400_000));
    }
}