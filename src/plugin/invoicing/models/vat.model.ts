import { Property } from '../../../entity';

/**
 * S = standard rate
 * Z = zero rated
 * E = tax-exempt
 * AE = VAT reverse charge
 * K = VAT exempt for EEA intra-community supply of goods and services
 * G = Free export item, tax not charged
 * O = Services outside scope of tax
 * L = Canary Islands general indirect tax
 * M = Tax for production, services and importation in Ceuta and Melilla.
 */
export type VatCategoryCode = 'S' | 'Z' | 'E' | 'AE' | 'K' | 'G' | 'O' | 'L' | 'M';

/**
 * Contains tax information.
 * Consists of the tax rate in percent and a Category Code used for x-rechnung.
 */
export class Vat {
    /**
     * The tax rate in percent.
     */
    @Property.number()
    rate!: number;
    /**
     * The category code used for x-rechnung.
     */
    @Property.string()
    categoryCode!: VatCategoryCode | string & {};
    /**
     * A description for why this is tax exempt.
     * Is required when categoryCode is set to 'E'.
     */
    @Property.string({ required: false })
    exemptionReason?: string;
}