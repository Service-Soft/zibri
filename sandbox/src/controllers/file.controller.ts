import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

import { Body, Controller, File, FileResponse, FormData, Get, MimeType, Post, Property, Response } from 'zibri';

export class FileCreateDTO {
    @Property.file({ allowedMimeTypes: [MimeType.JSON] })
    file!: File;
}

@Controller('/files')
export class FileController {
    @Response.file()
    @Post()
    async putThrough(
        @Body(FileCreateDTO, { type: MimeType.FORM_DATA })
        test: FormData<FileCreateDTO>
    ): Promise<FileResponse> {
        return await FileResponse.fromPath(test.value.file.path);
        // return await this.testRepository.create(test.value);
    }

    @Response.file()
    @Get('/stream')
    async findDocumentFor(): Promise<FileResponse> {
        // return new FileResponse({ data: 'assets/logo.jpg' });
        return FileResponse.fromStream({
            stream: createReadStream('assets/logo.jpg'),
            filename: 'logo.jpg',
            size: (await stat('assets/logo.jpg')).size
        });
    }
}