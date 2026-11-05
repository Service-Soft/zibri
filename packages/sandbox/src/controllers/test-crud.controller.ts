import { Controller, CrudController, IntersectionClass, OmitClass, PickClass } from 'zibri';

import { Test, TestCreateDTO, TestUpdateDTO } from '../models';
import { TemplateController } from './template.controller';

@Controller('/tests-crud', { versions: 'all' })
export class TestCrudController extends IntersectionClass(
    OmitClass(CrudController(Test, TestCreateDTO, TestUpdateDTO), ['deleteById']),
    PickClass(TemplateController, ['getMailTemplate'])
) {}