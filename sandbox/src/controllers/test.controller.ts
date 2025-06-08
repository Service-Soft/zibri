import { Controller, Get, Post, Patch, Delete, Param, Body, Repository, InjectRepository, OmitType, Auth } from 'zibri';

import { Roles, Test, User } from '../models';
import { UserRepository } from '../repositories';

class CreateDTO extends OmitType(Test, ['id']) {}

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
    @Get()
    async find(): Promise<Test[]> {
        return await this.testRepository.findAll();
    }

    @Get('/:id')
    async findById(
        @Param.path('id', { format: 'uuid' })
        id: string
    ): Promise<Test> {
        return await this.testRepository.findById(id);
    }

    @Auth.hasRole([Roles.USER])
    @Post()
    async create(
        @Body(CreateDTO)
        test: CreateDTO
    ): Promise<Test> {
        return await this.testRepository.create(test);
    }

    @Patch('/:id')
    async updateById(
        @Param.path('id', { format: 'uuid' })
        id: string,
        @Body(Test)
        data: Test
    ): Promise<Test> {
        return await this.testRepository.updateById(id, data);
    }

    @Delete('/:id')
    async deleteById(
        @Param.path('id', { format: 'uuid' })
        id: string
    ): Promise<void> {
        await this.testRepository.deleteById(id);
    }
}