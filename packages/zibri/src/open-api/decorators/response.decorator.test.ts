/* eslint-disable typescript/require-await */
import { describe, expect, it } from '@jest/globals';

import { Response } from './response.decorator';
import { KeysetPage, PaginationResult } from '../../data-source/models/pagination-result.model';
import { Property } from '../../entity/decorators/property.decorator';
import { HttpStatus } from '../../http/http-status.enum';
import { JsonResponse } from '../../http/json-response.model';
import { RedirectResponse } from '../../http/redirect-response.model';
import { FileResponse } from '../../parsing/form-data/file-response.model';
import { HtmlResponse } from '../../parsing/html/html-response.model';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { OpenApiResponse } from '../open-api.model';

class Task {
    @Property.string()
    title!: string;
}

class Comment {
    @Property.string()
    text!: string;
}

/**
 * A declaration says what a route answers with, and the method's return type says the same thing a
 * second time. A declaration the method cannot return is a compile error (08 §X22), checked by
 * `npm run typecheck`: the `@ts-expect-error` lines below fail it when the declaration is accepted.
 */

class DeclaredResponses {
    @Response.object(Task)
    @Response.array(Task)
    @Response.paginated(Task)
    @Response.empty()
    @Response.error(HttpStatus.NOT_FOUND)
    async union(): Promise<void | Task | Task[] | PaginationResult<Task>> {
        return undefined;
    }

    @Response.object(() => Task)
    async lateClass(): Promise<Task> {
        return { title: 'Write the release notes' };
    }

    @Response.object(Task)
    async withHeaders(): Promise<JsonResponse<Task>> {
        return JsonResponse.of({ title: 'Write the release notes' }, { headers: { etag: '"1"' } });
    }

    @Response.keysetPage(Task)
    async page(): Promise<KeysetPage<Task>> {
        return { items: [], totalAmount: 0, nextCursor: undefined };
    }

    @Response.file()
    @Response.html()
    @Response.redirect()
    async other(): Promise<FileResponse | HtmlResponse | RedirectResponse> {
        return HtmlResponse.fromString('<p>Tasks</p>');
    }

    @Response.object(Task)
    synchronous(): Task {
        return { title: 'Write the release notes' };
    }

    @Response.object(Task)
    async unknownBody(): Promise<unknown> {
        return undefined;
    }

    // @ts-expect-error -- a Comment is not what the method returns
    @Response.object(Comment)
    async wrongClass(): Promise<Task> {
        return { title: 'Write the release notes' };
    }

    // @ts-expect-error -- an array is declared, a single task is returned
    @Response.array(Task)
    async arrayOnSingle(): Promise<Task> {
        return { title: 'Write the release notes' };
    }

    // @ts-expect-error -- a page is declared, a bare array is returned
    @Response.paginated(Task)
    async pageOnArray(): Promise<Task[]> {
        return [];
    }

    // @ts-expect-error -- nothing is declared, a task is returned
    @Response.empty()
    async emptyOnValue(): Promise<Task> {
        return { title: 'Write the release notes' };
    }

    // @ts-expect-error -- html is declared, json is returned
    @Response.html()
    async htmlOnJson(): Promise<Task> {
        return { title: 'Write the release notes' };
    }

    // @ts-expect-error -- a task is declared, another body is wrapped
    @Response.object(Task)
    async wrongWrappedBody(): Promise<JsonResponse<Comment>> {
        return JsonResponse.of({ text: 'Looks good' }, { headers: {} });
    }
}

describe('Response', () => {
    it('records what each decorator declares on the route', () => {
        const responses: OpenApiResponse[] = MetadataUtilities.getRouteResponses(DeclaredResponses, 'union');

        expect(responses.map(response => response.type).sort()).toEqual(['empty', 'error', 'json', 'json', 'json']);
    });
});