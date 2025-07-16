import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import path from 'path';

import { AssetService, Body, Controller, File, FileResponse, FormData, Get, Inject, MimeType, Post, Property, Response, ZIBRI_DI_TOKENS } from 'zibri';

export class FileCreateDTO {
    @Property.file({ allowedMimeTypes: [MimeType.JSON] })
    file!: File;
}

@Controller('/files')
export class FileController {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.ASSET_SERVICE)
        private readonly assetService: AssetService
    ) {}

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
        const assetPath: string = path.join(this.assetService.publicAssetsPath, 'logo.jpg');
        return FileResponse.fromStream({
            stream: createReadStream(assetPath),
            filename: 'logo.jpg',
            size: (await stat(assetPath)).size
        });
    }
}