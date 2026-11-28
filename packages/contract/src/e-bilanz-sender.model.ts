import { type GermanCompanyAddressModel } from './german-company-address.model';

/**
 * Who sends an E-Bilanz to the tax administration (Datenlieferant), as the transmission protocol names them.
 */
export type EBilanzSenderModel = {
    /**
     * The name of the sender.
     */
    name: string,
    /**
     * The address of the sender.
     */
    address: GermanCompanyAddressModel,
    /**
     * The phone number of the sender, or null for none.
     */
    phone?: string | null,
    /**
     * The email address of the sender, or null for none.
     */
    email?: string | null
};