import { Property } from '../../../entity/decorators/property.decorator.ts';

/**
 * The address a party of an electronic invoice receives invoices at, eg. Its Peppol participant id.
 */
export class ElectronicAddress {
    /**
     * The scheme of the address, from the code list "Electronic Address Scheme" (EAS), eg. `0204` for a
     * Leitweg-ID, `9930` for a German VAT id or `0088` for a GLN.
     */
    @Property.string()
    scheme!: string;
    /**
     * The address within its scheme.
     */
    @Property.string()
    value!: string;
}