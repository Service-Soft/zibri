import { TOTP } from 'otpauth';
import { createPostgresTestDataSource, defaultClusterProviders, defaultClusterTestEntities, StartTestServerOptions } from 'zibri-testing';

import { OtpRegistration, OtpTwoFactorMethod } from './otp.two-factor-method';
import { OTP_PERIOD_IN_SECONDS } from './otp.utilities';
import { JwtTestAuthController } from '../../../../__testing__/mocks/controllers/jwt-test-auth.controller';
import { JwtUser } from '../../../../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../../../../__testing__/mocks/entities/roles.enum';
import { TestMembership } from '../../../../__testing__/mocks/entities/test-membership.entity';
import { TestRole } from '../../../../__testing__/mocks/entities/test-role.entity';
import { defaultTestServerRepositories } from '../../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerPermissions, defaultTestServerRoles, rolesAndPermissionsProviders, testServerPasswordPolicyProvider } from '../../../../__testing__/test-server/providers';
import { DataSourceInterface } from '../../../../data-source/data-sources/data-source.interface';
import { Repository } from '../../../../data-source/repository/repository';
import { InjectRepository } from '../../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../../di/inject.function';
import { Response } from '../../../../open-api/decorators/response.decorator';
import { Controller } from '../../../../routing/decorators/controller.decorator';
import { Param } from '../../../../routing/decorators/param.decorator';
import { Post } from '../../../../routing/decorators/post.decorator';
import { Newable } from '../../../../types/newable.type';
import { Ms } from '../../../../utilities/ms';
import { PasswordCredentials, PasswordCredentialsCreateData } from '../../../authenticators/password/password-credentials.model';
import { Auth } from '../../../decorators/auth.decorator';
import { type TwoFactorServiceInterface } from '../../two-factor-service.interface';

/**
 * The data sources every instance of this scenario boots on.
 *
 * The harness's cluster default plus this repository's user, because the scenario logs in and the
 * auth controller needs a user to find. Which class that is belongs to the application, so the
 * shipped default does not name one.
 *
 * A module level constant, because the parent process and each instance read this same module and
 * have to agree on how many data sources there are and in which order - the mapped ports are
 * indexed by that.
 */
const clusterDataSources: Newable<DataSourceInterface>[] = [
    // needs to be distributed
    createPostgresTestDataSource({
        entities: [...defaultClusterTestEntities, JwtUser, TestMembership, TestRole],
        repositories: defaultTestServerRepositories
    })
];

/**
 * What every instance of the otp cluster boots with.
 *
 * A code is single use, and the record of it having been used is a lease rather than anything the
 * process keeps to itself. That distinction only shows up with more than one replica: a store local
 * to the process refuses the second use just as convincingly, right up until the replay is sent to a
 * different pod.
 *
 * No data source of its own - the default one carries the users, the credentials and the leases
 * alike, which is what every replica reading the same record means here.
 */

/**
 * The password every enrolled user is created with.
 *
 * Exported so the parent can log in as one of them without the fixture having to hand a token back:
 * logging in over http is what a client does, and it is the same access token either way.
 */
export const otpUserPassword: string = 'secure123';

/**
 * The email a tagged enrollment belongs to.
 *
 * Exported for the same reason `otpUserPassword` is: the parent logs in over http the way a client
 * does, so it needs to name the user without the fixture handing anything extra back.
 * @param tag - What the enrollment was named.
 * @returns The email the user was created with.
 */
export function otpUserEmail(tag: string): string {
    return `otp-${tag}@example.com`;
}

/**
 * Enrolls users with a working authenticator, and guards one operation behind a second factor.
 */
@Controller('/cluster-otp')
class ClusterOtpController {
    constructor(
        @InjectRepository(JwtUser)
        private readonly userRepository: Repository<JwtUser>,
        @InjectRepository(PasswordCredentials)
        private readonly credentialsRepository: Repository<PasswordCredentials, PasswordCredentialsCreateData>,
        @Inject(ZIBRI_DI_TOKENS.TWO_FACTOR_SERVICE)
        private readonly twoFactorService: TwoFactorServiceInterface
    ) {}

    /**
     * Creates a user with a confirmed authenticator and hands back what it takes to act as one.
     *
     * Tagged rather than a single fixed user, because a spent code stays spent for its whole window:
     * two tests inside the same half minute need two enrollments to have two unspent codes.
     * @param tag - What to name this enrollment.
     * @returns What enrolling answers, whose secret is what generates codes.
     */
    @Response.object(OtpRegistration)
    @Post('/enroll/:tag')
    async enroll(
        @Param.path('tag')
        tag: string
    ): Promise<OtpRegistration> {
        const email: string = otpUserEmail(tag);
        const user: JwtUser = await this.userRepository.create({ email, roles: [Roles.USER] });
        await this.credentialsRepository.create({ password: otpUserPassword, userId: user.id });

        const method: OtpTwoFactorMethod = inject(OtpTwoFactorMethod);
        const registration: OtpRegistration = await this.twoFactorService.requestTwoFactorRegistration(
            user,
            method,
            undefined
        );

        // confirmed with the previous window's code on purpose. Confirming is a successful
        // validation, so it spends the code it is given - doing that with the current one would
        // leave the caller holding digits that are already used, and every test below would pass
        // for the wrong reason.
        await this.twoFactorService.confirmTwoFactorRegistration(user, method, {
            token: new TOTP({ secret: registration.secret, period: OTP_PERIOD_IN_SECONDS })
                .generate({ timestamp: Date.now() - (OTP_PERIOD_IN_SECONDS * Ms.SECOND) })
        });

        return registration;
    }

    /**
     * The kind of operation a second factor is asked for: reachable only with a code.
     */
    @Auth.require2fa()
    @Post('/sensitive')
    sensitive(): void {}
}

const options: StartTestServerOptions = {
    dataSources: clusterDataSources,
    // the real auth controller, so the parent logs in the way a client does rather than through a
    // route written to make the test convenient
    controllers: [ClusterOtpController, JwtTestAuthController],
    // the cluster's defaults, the policy the passwords here meet, and the roles the users here hold
    providers: [
        ...defaultClusterProviders,
        testServerPasswordPolicyProvider,
        ...rolesAndPermissionsProviders(defaultTestServerPermissions, defaultTestServerRoles)
    ]
};

export default options;