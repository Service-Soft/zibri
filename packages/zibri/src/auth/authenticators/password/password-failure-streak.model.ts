import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { OmitStrict } from '../../../types/omit-strict.type';

/**
 * The wrong passwords a user has presented in a row, and until when the account is locked for them.
 *
 * One row per user, removed by the next correct password.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class PasswordFailureStreak extends BaseEntity {
    /**
     * The user the passwords were presented for.
     */
    @Property.string({ format: 'uuid', unique: true })
    userId!: string;

    /**
     * How many wrong passwords in a row.
     */
    @Property.number({ format: 'integer' })
    count!: number;

    /**
     * Until when the streak reaching the application's `passwordFailureLimit` locks the account, or
     * null while it has not.
     */
    @Property.date({ required: false })
    lockedUntil?: Date | null;
}

/**
 * The data for starting a streak.
 */
export type PasswordFailureStreakCreateData = OmitStrict<PasswordFailureStreak, 'id'>;