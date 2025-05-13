import { Controller, Get, Post, Patch, Delete, Param, NotFoundError, Body, Property } from 'zibri';
import { logger } from '..';

class Test {
    @Property({ type: 'string' })
    id!: string;
    @Property({ type: 'number' })
    value!: number;
}

@Controller('/tests')
export class TestController {
    private readonly testData: Test[] = [
        {
            id: '1',
            value: 42
        }
    ];

    @Get()
    find(
        @Param.query('filter', { type: 'object', cls: Test })
        filter: Test,
        @Param.header('Referer', { required: false })
        referer?: string,
        @Param.query('search', { type: 'number', required: false })
        search?: number,
    ): Test[] {
        logger.info('filter', JSON.stringify(filter));
        if (search != undefined) {
            return this.testData.filter(t => t.value === search);
        }
        return this.testData;
    }

    @Get('/:id')
    findById(
        @Param.path('id')
        id: string
    ): Test {
        const res = this.testData.find(t => t.id === id);
        if (!res) {
            throw new NotFoundError(`Could not find test entity with id "${id}"`);
        }
        return res;
    }

    @Post()
    create(
        @Body(Test)
        test: Test
    ): Test {
        this.testData.push(test);
        return test;
    }

    @Patch('/:id')
    updateById(
        @Param.path('id')
        id: string,
        @Body(Test)
        updateData: Partial<Test>
    ): Test {
        const toUpdate: Test = this.findById(id);
        this.testData[this.testData.indexOf(toUpdate)] = {...toUpdate, ...updateData};
        return this.testData[this.testData.indexOf(toUpdate)]
    }

    @Delete('/:id')
    deleteById(
        @Param.path('id')
        id: string
    ): void {
        const toDelete: Test = this.findById(id);
        this.testData.splice(this.testData.indexOf(toDelete), 1);
    }
}