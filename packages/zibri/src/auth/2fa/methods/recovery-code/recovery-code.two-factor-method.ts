import { randomBytes } from 'node:crypto';

import { RecoveryCodeOptions } from './recovery-code-options.model';
import { TwoFactorRecoveryCode, TwoFactorRecoveryCodeCreateData } from './two-factor-recovery-code.model';
import { ZibriApplication } from '../../../../application/application';
import { HttpRequestContext } from '../../../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../../../context/request/websocket-request.context';
import { Repository } from '../../../../data-source/repository/repository';
import { type RepositoryTransaction } from '../../../../data-source/transaction/repository-transaction.type';
import { repositoryTokenFor } from '../../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../../di/inject.function';
import { Property } from '../../../../entity/decorators/property.decorator';
import { UnauthorizedError } from '../../../../error-handling/errors/unauthorized.error';
import { InternalError } from '../../../../error-handling/internal-error.model';
import { findHeader } from '../../../../http/find-header.function';
import { $ts } from '../../../../localization/translate.function';
import { Newable } from '../../../../types/newable.type';
import { validateEntitiesRegistered } from '../../../../utilities/validate-entities-registered.function';
import { type HashServiceInterface } from '../../../hash/hash-service.interface';
import { type HashString } from '../../../hash/hash.utilities';
import { Sha256HashStrategy } from '../../../hash/strategies/sha256.hash-strategy';
import { UserAccount } from '../../../models/user-account.model';
import { InvalidTwoFactorCodeError } from '../../invalid-two-factor-code.error';
import { NoRegistrationRequestData } from '../no-registration-request-data.model';
import { base32Encode } from '../otp/base32-encode.function';
import { TwoFactorMethod } from '../two-factor-method.interface';

/**
 * How many codes a set holds, unless `RECOVERY_CODE_OPTIONS` says.
 */
const DEFAULT_RECOVERY_CODE_COUNT: number = 10;

/**
 * How many characters a code has, without the dash it is shown with, unless `RECOVERY_CODE_OPTIONS`
 * says, and the fewest it may say: 50 bits of base32.
 */
const MIN_RECOVERY_CODE_LENGTH: number = 10;

/**
 * The data for confirming the registration of recovery codes: one code of the set, which proves the
 * user kept it.
 */
export class RecoveryCodeRegistrationConfirmData {
    /**
     * One of the codes, with or without its dash.
     */
    @Property.string()
    code!: string;
}

/**
 * The recovery codes of a new set, shown once.
 */
export class RecoveryCodeRegistration {
    /**
     * The codes. None of them can be shown again.
     */
    @Property.array({ items: { type: 'string' } })
    codes!: string[];
}

/**
 * Recovery codes: a set of codes, each of which can be presented once in place of a second factor.
 *
 * The way back for a user who lost their device, and for one whose second factor is locked after too
 * many wrong codes: presenting one then removes the locked methods and lifts the lock.
 */
export class RecoveryCodeTwoFactorMethod implements TwoFactorMethod<void, RecoveryCodeRegistrationConfirmData, RecoveryCodeRegistration> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'recovery-code';

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly registrationRequestModel: Newable<void> = NoRegistrationRequestData;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly registrationConfirmModel: Newable<RecoveryCodeRegistrationConfirmData> = RecoveryCodeRegistrationConfirmData;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly registrationRequestResultModel: Newable<RecoveryCodeRegistration> = RecoveryCodeRegistration;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly secondFactorRequestModel: undefined = undefined;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly unlocksLockedFactors: boolean = true;

    // read when used rather than injected, so that an application without the entity is told to
    // declare it by init, instead of failing on a repository token while this is built
    private get recoveryCodeRepository(): Repository<TwoFactorRecoveryCode, TwoFactorRecoveryCodeCreateData> {
        return inject(repositoryTokenFor(TwoFactorRecoveryCode));
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.RECOVERY_CODE_HEADER)
        private readonly recoveryCodeHeader: string,
        @Inject(ZIBRI_DI_TOKENS.HASH_SERVICE)
        private readonly hashService: HashServiceInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    init(app: ZibriApplication): void {
        validateEntitiesRegistered(RecoveryCodeTwoFactorMethod.name, app, TwoFactorRecoveryCode);
        const { count, length } = this.resolveOptions();
        if (!Number.isInteger(count) || count < 1) {
            throw new InternalError(`ZIBRI_DI_TOKENS.RECOVERY_CODE_OPTIONS.count must be a whole number of at least 1, got ${count}.`);
        }
        // fewer characters would make each code a guess worth trying, at a factor that lifts a lock
        if (!Number.isInteger(length) || length < MIN_RECOVERY_CODE_LENGTH) {
            throw new InternalError(
                `ZIBRI_DI_TOKENS.RECOVERY_CODE_OPTIONS.length must be a whole number of at least ${MIN_RECOVERY_CODE_LENGTH},`
                + ` got ${length}.`
            );
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestRegistration<UserType extends UserAccount>(
        user: UserType
    ): Promise<RecoveryCodeRegistration> {
        // a set that was never confirmed is given up on, while the confirmed one keeps working until
        // the new one is confirmed in its place
        await this.recoveryCodeRepository.deleteAll({ userId: user.id, confirmed: false });
        const { count, length } = this.resolveOptions();
        const codes: string[] = Array.from({ length: count }, () => this.generateCode(length));
        await this.recoveryCodeRepository.createAll(codes.map(code => ({ userId: user.id, code })));
        const half: number = Math.ceil(length / 2);
        return { codes: codes.map(c => `${c.slice(0, half)}-${c.slice(half)}`) };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async requestSecondFactor(): Promise<void> {
        // the user holds the codes, so there is nothing to request
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async confirmRegistration<UserType extends UserAccount>(
        user: UserType,
        data: RecoveryCodeRegistrationConfirmData
    ): Promise<void> {
        const found: TwoFactorRecoveryCode | undefined = await this.recoveryCodeRepository.findOne({
            where: { userId: user.id, code: await this.hash(data.code), confirmed: false },
            required: false
        });
        if (!found) {
            throw new InvalidTwoFactorCodeError();
        }
        // the new set replaces the old one, whose codes stop working
        await this.recoveryCodeRepository.deleteAll({ userId: user.id, confirmed: true });
        await this.recoveryCodeRepository.updateAll({ userId: user.id, confirmed: false }, { confirmed: true });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async removeRegistration<UserType extends UserAccount>(user: UserType): Promise<void> {
        await this.recoveryCodeRepository.deleteAll({ userId: user.id });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteUserRows(userIds: string[], transaction: RepositoryTransaction): Promise<void> {
        await this.recoveryCodeRepository.deleteAll({ userId: { oneOf: userIds } }, { transaction });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async isRegistered<UserType extends UserAccount>(user: UserType): Promise<boolean> {
        const found: TwoFactorRecoveryCode | undefined = await this.recoveryCodeRepository.findOne({
            where: { userId: user.id, confirmed: true },
            required: false
        });
        return found != undefined;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async validate<UserType extends UserAccount>(
        user: UserType,
        context: HttpRequestContext | WebsocketRequestContext
    ): Promise<void> {
        const presented: string | undefined = findHeader(context.request.headers, this.recoveryCodeHeader);
        if (!presented) {
            throw new UnauthorizedError($ts`"${this.recoveryCodeHeader}" header not found`);
        }
        const found: TwoFactorRecoveryCode | undefined = await this.recoveryCodeRepository.findOne({
            where: { userId: user.id, code: await this.hash(presented), confirmed: true },
            required: false
        });
        if (!found) {
            throw new InvalidTwoFactorCodeError();
        }
        // spent by being deleted. Two requests presenting it at once cannot both get here, since the
        // two factor service checks one code per user at a time
        await this.recoveryCodeRepository.deleteById(found.id);
    }

    /**
     * Hashes a code the way it is stored, after reading it the way it is shown: without its dash, and
     * in any case.
     * @param code - The code as it was presented.
     * @returns Its stored hash.
     */
    private async hash(code: string): Promise<HashString> {
        return await this.hashService.hash(code.replaceAll(/[\s-]/g, '').toUpperCase(), { strategy: Sha256HashStrategy });
    }

    /**
     * Generates a code.
     * @param length - How many characters it has.
     * @returns The code, in base32.
     */
    private generateCode(length: number): string {
        // five bits a character, so as many bytes as hold that many bits
        return base32Encode(randomBytes(Math.ceil((length * 5) / 8))).slice(0, length);
    }

    /**
     * Resolves how many codes a set holds, and how long each is.
     * @returns The options, the defaults filled in.
     */
    private resolveOptions(): Required<RecoveryCodeOptions> {
        const options: RecoveryCodeOptions = inject(ZIBRI_DI_TOKENS.RECOVERY_CODE_OPTIONS);
        return { count: options.count ?? DEFAULT_RECOVERY_CODE_COUNT, length: options.length ?? MIN_RECOVERY_CODE_LENGTH };
    }
}