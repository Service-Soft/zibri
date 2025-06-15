import { Controller, Get, Post, Patch, Delete, Param, Body, Repository, InjectRepository, Auth, Response } from 'zibri';

import { Roles, Test, TestCreateDTO, User } from '../models';
import { UserRepository } from '../repositories';

@Auth.isLoggedIn()
@Controller('/tests')
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
        @Param.path('id', { format: 'uuid' })
        id: string
    ): Promise<Test> {
        return await this.testRepository.findById(id);
    }

    @Response.file()
    @Get('/:id/document')
    async findDocumentFor(
        @Param.path('id', { format: 'uuid' })
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
        @Param.path('id', { format: 'uuid' })
        id: string,
        @Body(Test)
        data: Test
    ): Promise<Test> {
        return await this.testRepository.updateById(id, data);
    }

    @Response.empty()
    @Delete('/:id')
    async deleteById(
        @Param.path('id', { format: 'uuid' })
        id: string
    ): Promise<void> {
        await this.testRepository.deleteById(id);
    }
}