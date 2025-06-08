import { Auth, AuthServiceInterface, Body, Controller, CurrentUser, Get, HashUtilities, Inject, InjectRepository, JwtAuthData, JwtAuthStrategy, JwtCredentials, JwtCredentialsDto, Post, Repository, Transaction, ZIBRI_DI_TOKENS } from 'zibri';

import { logger } from '..';
import { DbDataSource } from '../data-sources';
import { Roles, User, UserCreateDto } from '../models';
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

    @Get('/users')
    async get(): Promise<User[]> {
        return await this.userRepository.findAll();
    }

    @Post('/login')
    async login(
        @Body(JwtCredentialsDto)
        credentials: JwtCredentialsDto
    ): Promise<JwtAuthData<Roles>> {
        return await this.authService.login(JwtAuthStrategy<Roles>, credentials);
    }

    @Auth.isLoggedIn()
    @Get('/users/me')
    getCurrentUser(
        @CurrentUser()
        user: User
    ): User {
        return user;
    }
}