import { ClusterMark, clusterInstanceId, createPostgresTestDataSource, defaultClusterTestEntities, StartTestServerOptions } from 'zibri-testing';

import { Auth } from '../../../auth/decorators/auth.decorator';
import { JwtAuthController } from '../../../auth/strategies/jwt/jwt-auth.controller';
import { JwtCredentials, JwtCredentialsCreateData } from '../../../auth/strategies/jwt/jwt-credentials.model';
import { DataSourceInterface } from '../../../data-source/data-sources/data-source.interface';
import { Repository } from '../../../data-source/repository/repository';
import { InjectRepository, repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { inject } from '../../../di/inject.function';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Get } from '../../../routing/decorators/get.decorator';
import { Param } from '../../../routing/decorators/param.decorator';
import { Post } from '../../../routing/decorators/post.decorator';
import { Newable } from '../../../types/newable.type';
import { JwtUser } from '../../mocks/entities/jwt-user.entity';
import { Roles } from '../../mocks/entities/roles.enum';
// eslint-disable-next-line eslintImport/no-unassigned-import
import '../../test-server/user-repository'; // this import is needed so that the DI system can pick up the user repository.

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
    createPostgresTestDataSource({ entities: [...defaultClusterTestEntities, JwtUser] })
];

/**
 * What every instance of the baseline cluster boots with.
 *
 * Nothing about the framework is asserted through this. It exists so the harness itself can be
 * proven: that the instances really are separate processes, that each one is individually
 * addressable, and that they really do share one data source.
 *
 * Like every instance options module, this is imported by the parent as well - that is how the
 * harness learns which containers to start - so nothing at the top level may assume it is running
 * inside an instance. ClusterInstanceId() is therefore read per request, not once on load.
 */

/**
 * The password every user created here can log in with.
 *
 * Exported so the parent can log in over http the way a client does, rather than having the fixture
 * hand a token back through a route written to make the test convenient.
 */
export const baselineUserPassword: string = 'secure123';

/**
 * The email a tagged user is created with.
 * @param tag - What the user was named.
 * @returns The email to log in as.
 */
export function baselineUserEmail(tag: string): string {
    return `baseline-${tag}@example.com`;
}

/**
 * Lets the parent ask an instance who it is, and tell it to leave a trace.
 */
@Controller('/cluster-baseline')
class BaselineController {
    constructor(
        @InjectRepository(JwtUser)
        private readonly userRepository: Repository<JwtUser>,
        @InjectRepository(JwtCredentials)
        private readonly credentialsRepository: Repository<JwtCredentials, JwtCredentialsCreateData>
    ) {}

    /**
     * Answers with the id of the instance that handled the request.
     * @returns The instance id.
     */
    @Get('/who')
    who(): string {
        return clusterInstanceId();
    }

    /**
     * Creates a user who can log in.
     * @param tag - What to name the user.
     */
    @Post('/user/:tag')
    async createUser(
        @Param.path('tag')
        tag: string
    ): Promise<void> {
        const email: string = baselineUserEmail(tag);
        const user: JwtUser = await this.userRepository.create({ email, roles: [Roles.USER] });
        await this.credentialsRepository.create({ email, password: baselineUserPassword, userId: user.id });
    }

    /**
     * Answers only to a caller this instance accepts, with the id of the instance that accepted them.
     * @returns The instance id.
     */
    @Auth.isLoggedIn()
    @Get('/me')
    me(): string {
        return clusterInstanceId();
    }

    /**
     * Records that this instance handled a request.
     * @returns The id of the written mark.
     */
    @Post('/mark')
    async mark(): Promise<string> {
        const repository: Repository<ClusterMark> = inject(repositoryTokenFor(ClusterMark));
        const mark: ClusterMark = await repository.create({
            instanceId: clusterInstanceId(),
            kind: 'baseline',
            tag: 'manual',
            at: new Date()
        });
        return mark.id;
    }
}

const options: StartTestServerOptions = {
    dataSources: clusterDataSources,
    // the real auth controller, so the parent logs in the way a client does and the token it gets
    // back is the one the framework actually issues
    controllers: [BaselineController, JwtAuthController]
};

export default options;