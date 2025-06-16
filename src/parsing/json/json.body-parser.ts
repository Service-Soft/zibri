import express from 'express';

import { BadRequestError } from '../../error-handling';
import { HttpRequest, MimeType } from '../../http';
import { BodyParserInterface } from '../body-parser.interface';
import { BodyParser } from '../decorators';

@BodyParser()
export class JsonBodyParser implements BodyParserInterface {
    readonly contentType: MimeType = MimeType.JSON;

    async parse(req: HttpRequest): Promise<unknown> {
        if (req.body !== undefined) {
            return req.body;
        }
        try {
            const res: unknown = await new Promise((resolve, reject) => {
                // eslint-disable-next-line typescript/no-unsafe-argument, typescript/no-explicit-any
                express.json({ strict: false })(req, {} as any, err => {
                    if (err != undefined) {
                        reject(err);
                    }
                    else {
                        resolve(req.body);
                    }
                });
            });
            return res;
        }
        catch {
            throw new BadRequestError('invalid JSON in request body');
        }
    }
}