/* eslint-disable cspell/spellchecker */
import { describe, expect, it } from '@jest/globals';

import { InvoiceAddress } from '../invoicing/models/invoice-address.model';
import { BankMatchUtilities } from './bank-match.utilities';

const company: InvoiceAddress = {
    formOfAddress: '',
    firstName: '',
    lastName: '',
    street: 'Great Street',
    number: '42',
    postcode: '12345',
    city: 'Great City',
    company: true,
    companyName: 'Müller & Söhne GmbH',
    countryId: 'DE'
};

describe('BankMatchUtilities', () => {
    it('finds an invoice number in what a payer wrote, with or without its separators, as a word of its own', () => {
        const found: boolean[] = [
            'Invoice 2026-SIEMEN-0001, thank you',
            'RE-NR. 2026 siemen 0001',
            '2026/SIEMEN/0001',
            'Rechnung 2026SIEMEN0001 bezahlt',
            '2026-SIEMEN-00012',
            '12026-SIEMEN-0001',
            'Invoice 2026-SIEMEN-001'
        ].map(text => BankMatchUtilities.containsInvoiceNumber(text, '2026-SIEMEN-0001'));

        expect(found).toEqual([true, true, true, true, false, false, false]);
    });

    it('takes a counterparty for the recipient by the words of its name, without the legal form and accents', () => {
        const isRecipient: boolean[] = [
            'MUELLER UND SOEHNE',
            'Mueller & Soehne GmbH & Co. KG',
            'MULLER SOHNE',
            'Söhne',
            undefined
        ].map(name => BankMatchUtilities.isRecipient(name, company));

        expect(isRecipient).toEqual([false, false, true, false, false]);
        expect(BankMatchUtilities.isRecipient('Max Mustermann', { ...company, company: false, firstName: 'Max', lastName: 'Mustermann' })).toBe(true);
        expect(BankMatchUtilities.isRecipient('Small Shop GmbH', { ...company, companyName: 'GmbH' })).toBe(false);
    });
});