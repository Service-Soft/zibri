import express from 'express';

import { BadRequestError } from '../../error-handling';
import { HttpRequest, isHttpRequest, MimeType } from '../../http';
import { WebsocketRequest } from '../../websocket';
import { BodyParserInterface } from '../body-parser.interface';
import { BodyParser } from '../decorators';

/**
 * Body parser for json.
 */
@BodyParser()
export class JsonBodyParser implements BodyParserInterface {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly contentType: MimeType = MimeType.JSON;

    // eslint-disable-next-line jsdoc/require-jsdoc
    async parse(req: HttpRequest | WebsocketRequest): Promise<unknown> {
        if (req.body !== undefined) {
            return req.body;
        }
        if (!isHttpRequest(req)) {
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