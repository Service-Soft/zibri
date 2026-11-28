import { type EBilanzSenderModel } from 'zibri-contract';

import { Property } from '../../../../entity/decorators/property.decorator';
import { BookkeepingLimits } from '../../models/bookkeeping-limits.model';
import { GermanCompanyAddress } from './german-company-address.model';

/**
 * Who sends an E-Bilanz to the tax administration (Datenlieferant), as the transmission protocol names them.
 */
export class EBilanzSender implements EBilanzSenderModel {
    /**
     * The name of the sender.
     */
    @Property.string({ minLength: 1, maxLength: BookkeepingLimits.NAME_MAX_LENGTH })
    name!: string;

    /**
     * The address of the sender.
     */
    @Property.object({ cls: () => GermanCompanyAddress })
    address!: GermanCompanyAddress;

    /**
     * The phone number of the sender, or null for none.
     */
    @Property.string({ required: false, maxLength: 50 })
    phone?: string | null;

    /**
     * The email address of the sender, or null for none.
     */
    @Property.string({ required: false, format: 'email' })
    email?: string | null;
}