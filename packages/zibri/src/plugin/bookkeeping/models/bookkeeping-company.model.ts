import { type BookkeepingCompanyModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { BookkeepingLimits } from './bookkeeping-limits.model';

/**
 * The company whose books they are, as its statements name it. A corporation under the HGB names all of it, § 264
 * (1a) HGB.
 */
export class BookkeepingCompany implements BookkeepingCompanyModel {
    /**
     * The name of the company, its firm, such as `Acme Software UG (haftungsbeschränkt)`.
     */
    @Property.string({ minLength: 1, maxLength: BookkeepingLimits.NAME_MAX_LENGTH })
    name!: string;

    /**
     * Where the company has its seat, such as `Berlin`, or null for none.
     */
    @Property.string({ required: false, maxLength: BookkeepingLimits.NAME_MAX_LENGTH })
    seat?: string | null;

    /**
     * The court of the register the company is entered in, such as `Amtsgericht Charlottenburg`, or null for none.
     */
    @Property.string({ required: false, maxLength: BookkeepingLimits.NAME_MAX_LENGTH })
    registerCourt?: string | null;

    /**
     * The number the company is entered in the register under, such as `HRB 123456 B`, or null for none.
     */
    @Property.string({ required: false, maxLength: BookkeepingLimits.NAME_MAX_LENGTH })
    registerNumber?: string | null;
}
