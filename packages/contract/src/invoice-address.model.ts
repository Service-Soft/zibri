import { type ElectronicAddressModel } from './electronic-address.model';

/**
 * The address an invoice goes to, of a private customer or of a company.
 */
export type InvoiceAddressModel = {
    /**
     * The form of address of the customer.
     */
    formOfAddress: string,
    /**
     * The first name of the customer.
     */
    firstName: string,
    /**
     * The last name of the customer.
     */
    lastName: string,
    /**
     * The email of the customer.
     */
    email?: string | null,
    /**
     * The address the customer receives electronic invoices at.
     */
    electronicAddress?: ElectronicAddressModel | null,
    /**
     * The street.
     */
    street: string,
    /**
     * The house number.
     */
    number: string,
    /**
     * The postcode.
     */
    postcode: string,
    /**
     * The city.
     */
    city: string,
    /**
     * The country, such as `DE`.
     */
    countryId: string,
    /**
     * Whether the customer is a company.
     */
    company: boolean,
    /**
     * The name of the company.
     */
    companyName?: string | null
};
