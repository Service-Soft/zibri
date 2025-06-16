import { Auth, AuthServiceInterface, Body, Controller, CurrentUser, Get, HashUtilities, Inject, InjectRepository, JwtAuthData, JwtAuthStrategy, JwtCredentials, JwtCredentialsDto, PaginationResult, Param, Post, Repository, Response, Transaction, ZIBRI_DI_TOKENS } from 'zibri';

import { logger } from '..';
import { DbDataSource } from '../data-sources';
import { Roles, Test, User, UserCreateDto } from '../models';
import { UserRepository } from '../repositories';

@Controller('/jwt')
export class JwtController {

    constructor(
        @Inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)
        private readonly authService: AuthServiceInterface,
        private readonly userRepository: UserRepository,
        @InjectRepository(JwtCredentials)
        private readonly jwtCredentialsRepository: Repository<JwtCredentials>,
        private readonly dataSource: DbDataSource
    ) {}

    @Response.empty()
    @Post('/register')
    async register(
        @Body(UserCreateDto)
        data: UserCreateDto
    ): Promise<void> {
        const transaction: Transaction = await this.dataSource.startTransaction();
        try {
            data.password = await HashUtilities.hash(data.password);
            const user: User = await this.userRepository.create(
                { email: data.email, roles: [Roles.USER], value: data.value },
                { transaction }
            );
            await this.jwtCredentialsRepository.create({ userId: user.id, username: data.email, password: data.password }, { transaction });
        }
        catch (error) {
            logger.error(error as Error);
        }
    }

    @Auth.belongsTo(Test)
    @Response.paginated(User)
    @Get('/users')
    async get(
        @Param.query('page', { type: 'number' })
        page: number,
        @Param.query('limit', { type: 'number' })
        limit: number
    ): Promise<PaginationResult<User>> {
        return await this.userRepository.findAllPaginated(page, limit);
    }

    @Response.object(JwtAuthData<Roles>)
    @Post('/login')
    async login(
        @Body(JwtCredentialsDto)
        credentials: JwtCredentialsDto
    ): Promise<JwtAuthData<Roles>> {
        return await this.authService.login(JwtAuthStrategy<Roles>, credentials);
    }

    @Auth.isLoggedIn()
    @Response.object(User)
    @Get('/users/me')
    getCurrentUser(
        @CurrentUser()
        user: User
    ): User {
        return user;
    }
}