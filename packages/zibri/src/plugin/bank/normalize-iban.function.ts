/**
 * Writes an IBAN the way the bank plugin stores it: in capitals and without spaces.
 * @param iban - The IBAN, such as `de89 3704 0044 0532 0130 00`.
 * @returns The IBAN, such as `DE89370400440532013000`.
 */
export function normalizeIban(iban: string): string {
    return iban.replaceAll(/\s/g, '').toUpperCase();
}