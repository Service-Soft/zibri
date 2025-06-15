import { Entity, OmitType, Property } from 'zibri';

@Entity()
export class Test {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    value!: string;

    // @Property.file()
    // file!: File;

    // @Property.array({ items: { type: 'file' }, totalFileSize: '5mb' })
    // files!: File;
}

export class TestCreateDTO extends OmitType(Test, ['id']) {}