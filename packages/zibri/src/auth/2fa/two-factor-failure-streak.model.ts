import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * The wrong two factor codes a user has presented in a row, and when the next one is checked.
 *
 * One row per user, removed by the next correct code.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class TwoFactorFailureStreak extends BaseEntity {
    /**
     * The user the codes were presented for.
     */
    @Property.string({ format: 'uuid', unique: true })
    userId!: string;

    /**
     * How many wrong codes in a row.
     */
    @Property.number()
    count!: number;

    /**
     * When the next code is checked. A code presented before then is refused unchecked.
     */
    @Property.date()
    retryAt!: Date;

    /**
     * When the streak reached the application's `twoFactorFailureLimit` and locked the user's second
     * factor, or null while it has not.
     */
    @Property.date({ required: false })
    lockedAt?: Date | null;
}

/**
 * The data for starting a streak.
 */
export type CreateTwoFactorFailureStreakData = OmitStrict<TwoFactorFailureStreak, 'id'>;