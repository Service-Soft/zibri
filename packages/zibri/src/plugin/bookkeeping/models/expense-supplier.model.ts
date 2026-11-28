import { type ExpenseSupplierModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { BookkeepingLimits } from './bookkeeping-limits.model';

/**
 * Who issued the document of an expense.
 */
export class ExpenseSupplier implements ExpenseSupplierModel {
    /**
     * The name, such as `Office Supplies GmbH`.
     */
    @Property.string({ maxLength: BookkeepingLimits.NAME_MAX_LENGTH })
    name!: string;

    /**
     * The address, its lines separated by line breaks, or null for none.
     */
    @Property.string({ required: false, maxLength: BookkeepingLimits.ADDRESS_MAX_LENGTH })
    address?: string | null;

    /**
     * The VAT identification number, such as `DE123456789`, or null for none.
     */
    @Property.string({ required: false, maxLength: BookkeepingLimits.VAT_ID_MAX_LENGTH })
    vatId?: string | null;
}