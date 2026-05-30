import { Controller, Get, Post, Patch, Delete, Param, Body, Repository, InjectRepository, Auth, Response, KnownHeader } from 'zibri';

import { Roles, Test, TestCreateDTO, User } from '../models';
import { UserRepository } from '../repositories';

@Auth.isLoggedIn()
@Controller('/tests', { versions: 'all' })
export class TestController {
    constructor(
        @InjectRepository(Test)
        private readonly testRepository: Repository<Test>,
        @InjectRepository(User)
        private readonly userRepository: UserRepository
    ) {}

    @Auth.isLoggedIn.skip()
    @Response.array(Test)
    @Get()
    async find(): Promise<Test[]> {
        return await this.testRepository.findAll();
    }

    @Response.object(Test)
    @Get('/:id')
    async findById(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string
    ): Promise<Test> {
        return await this.testRepository.findById(id);
    }

    @Auth.hasRole([Roles.USER])
    @Response.object(Test)
    @Post()
    async create(
        @Body(TestCreateDTO)
        test: TestCreateDTO
    ): Promise<Test> {
        return await this.testRepository.create(test);
    }

    @Response.object(Test)
    @Patch('/:id')
    async updateById(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @Param.header(KnownHeader.USER_AGENT)
        @Body(Test)
        data: Test
    ): Promise<Test> {
        await this.testRepository.findAll({ where: { value: [{ iLike: '%42', not: '42' }, '43'] } });
        return await this.testRepository.updateById(id, data);
    }

    @Auth.require2fa()
    @Response.empty()
    @Delete('/:id')
    async deleteById(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string
    ): Promise<void> {
        await this.testRepository.deleteById(id);
    }
}