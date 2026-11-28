import { type EBilanzAccountModel } from 'zibri-contract';

import { Property } from '../../../../entity/decorators/property.decorator';
import { BigNumber } from '../../../../utilities/number.utilities';

/**
 * An account under a position of an E-Bilanz, as its account level detail (Kontennachweis) states it.
 */
export class EBilanzAccount implements Omit<EBilanzAccountModel, 'balance'> {
    /**
     * The id of the account.
     */
    @Property.string({ format: 'uuid' })
    accountId!: string;

    /**
     * The number of the account.
     */
    @Property.string()
    number!: string;

    /**
     * The name of the account.
     */
    @Property.string()
    name!: string;

    /**
     * The balance of the account, positive on the side the position counts.
     */
    @Property.number({ format: 'bignumber' })
    balance!: BigNumber;
}