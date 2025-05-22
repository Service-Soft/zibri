import { Controller, Get, Post, Patch, Delete, Param, Body, Repository, InjectRepository, OmitType, PickType, IntersectionType } from 'zibri';
import { Test, User } from '../models';

class CreateDTO extends OmitType(Test, ['id']) {}

@Controller('/tests')
export class TestController {
    constructor(
        @InjectRepository(Test)
        private readonly testRepository: Repository<Test>,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>
    ) {}

    @Get()
    async find(): Promise<Test[]> {
        return await this.testRepository.findAll({ relations: [ '' ] });
    }

    @Get('/:id')
    async findById(
        @Param.path('id', { format: 'uuid' })
        id: string
    ): Promise<Test> {
        return await this.testRepository.findById(id);
    }

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
        return await this.testRepository.deleteById(id);
    }
}