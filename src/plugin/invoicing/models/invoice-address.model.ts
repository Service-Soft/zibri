import { Property } from '../../../entity/decorators/property.decorator';

/**
 * The invoice address, which can be either a private or a company address.
 */
export class InvoiceAddress {
    /**
     * The form of address of the customer.
     */
    @Property.string()
    formOfAddress!: string;
    /**
     * The first name of the customer.
     */
    @Property.string()
    firstName!: string;
    /**
     * The last name of the customer.
     */
    @Property.string()
    lastName!: string;
    /**
     * The email of the customer.
     * This does NOT have to be the same email where the invoice is sent.
     * It is required for factur-x or x-rechnung compliant invoices.
     */
    @Property.string({ required: false })
    email?: string;
    /**
     * The street of the address.
     */
    @Property.string()
    street!: string;
    /**
     * The number of the address.
     */
    @Property.string()
    number!: string;
    /**
     * The postcode of the address.
     */
    @Property.string({ minLength: 5, maxLength: 5 })
    postcode!: string;
    /**
     * The city of the address.
     */
    @Property.string()
    city!: string;
    /**
     * The country id of the address.
     * Eg. 'US'.
     */
    @Property.string()
    countryId!: string;
    /**
     * Whether or not the address is of a company.
     */
    @Property.boolean()
    company!: boolean;
    /**
     * The name of the company.
     */
    @Property.string({ required: false })
    companyName?: string;
}