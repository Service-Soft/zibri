import { Controller, CrudController, IntersectionClass, OmitClass, PickClass } from 'zibri';

import { Test, TestCreateDTO, TestUpdateDTO } from '../models';
import { MetricsController } from './metrics.controller';

@Controller('/tests-crud')
export class TestCrudController extends IntersectionClass(
    OmitClass(CrudController(Test, TestCreateDTO, TestUpdateDTO), ['deleteById']),
    PickClass(MetricsController, ['dashboard'])
) {}