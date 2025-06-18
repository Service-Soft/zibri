import { Entity, File, MimeType, OmitType, Property } from 'zibri';

@Entity()
export class Test {
    @Property.string({ primary: true })
    id!: string;

    @Property.string({ minLength: 28 })
    value!: string;

    // @Property.array({ items: { type: 'file' }, totalFileSize: '5mb' })
    // files!: File;
}

export class TestCreateDTO extends OmitType(Test, ['id']) {
    @Property.file({ allowedMimeTypes: [MimeType.JSON] })
    file!: File;
}