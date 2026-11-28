import { describe, expect, it } from '@jest/globals';

import { ICalendarUtilities } from './i-calendar.utilities';

/**
 * Unfolds the lines of a file, as a reader of it does (RFC 5545, section 3.1).
 * @param content - The file.
 * @returns Its lines, unfolded.
 */
function unfold(content: string): string[] {
    return content.replaceAll('\r\n ', '').split('\r\n')
        .filter(line => line !== '');
}

describe('ICalendarUtilities', () => {
    describe('escaping text', () => {
        it('escapes the description of the example of RFC 5545, section 3.3.11', () => {
            expect(ICalendarUtilities.escapeText('Project XYZ Final Review\nConference Room - 3B\nCome Prepared.'))
                .toBe('Project XYZ Final Review\\nConference Room - 3B\\nCome Prepared.');
        });

        it('puts a backslash before a backslash, a semicolon and a comma, and keeps a colon and a quote', () => {
            expect(ICalendarUtilities.escapeText('Pay: invoice "2026-001"; then 50,00 € to C:\\Accounting'))
                .toBe('Pay: invoice "2026-001"\\; then 50\\,00 € to C:\\\\Accounting');
        });

        it('writes every kind of line break as \\n, and leaves out the control characters but the tab', () => {
            expect(ICalendarUtilities.escapeText('one\r\ntwo\rthree\nfour\u0007\tfive\u001B'))
                .toBe('one\\ntwo\\nthree\\nfour\tfive');
        });
    });

    describe('folding a line', () => {
        it('leaves a line of 75 octets as it is', () => {
            const line: string = `SUMMARY:${'a'.repeat(67)}`;

            expect(ICalendarUtilities.foldLine(line)).toBe(line);
        });

        it('folds a longer line into lines of at most 75 octets, each after the first starting with a space', () => {
            const line: string = `DESCRIPTION:${'This is a long description that exists on a long line. '.repeat(4)}`;

            const folded: string[] = ICalendarUtilities.foldLine(line).split('\r\n');

            expect(folded.length).toBe(4);
            expect(folded.map(part => Buffer.byteLength(part, 'utf8'))).toEqual([75, 75, 75, 10]);
            expect(folded.slice(1).every(part => part.startsWith(' '))).toBe(true);
            expect(folded.map((part, index) => index === 0 ? part : part.slice(1)).join('')).toBe(line);
        });

        it('never splits the octets of a character, umlauts, characters of three octets and emojis alike', () => {
            // 8 octets of the name, then characters of two, three and four octets, offset so that the line limit
            // falls inside one of them
            const line: string = `SUMMARY:${'ü'.repeat(30)}${'€'.repeat(30)}${'🗓'.repeat(30)}x`;

            const folded: string[] = ICalendarUtilities.foldLine(line).split('\r\n');

            for (const part of folded) {
                expect(Buffer.byteLength(part, 'utf8')).toBeLessThanOrEqual(75);
                // a character split apart would come back as the replacement character
                expect(Buffer.from(part, 'utf8').toString('utf8')).not.toContain('\uFFFD');
                expect(part).not.toContain('\uFFFD');
            }
            expect(folded.map((part, index) => index === 0 ? part : part.slice(1)).join('')).toBe(line);
            // 8 and 60 octets, then two euro signs of three: a third would take the line to 77 octets
            expect(folded[0]).toBe(`SUMMARY:${'ü'.repeat(30)}${'€'.repeat(2)}`);
        });
    });

    describe('writing an event', () => {
        it('writes an event of a whole day as the example of RFC 5545, section 3.6.1, ending on the next day', () => {
            const content: string = ICalendarUtilities.writeEvent({
                uid: '20070423T123432Z-541111@example.com',
                stampedAt: new Date('2007-04-23T12:34:32.000Z'),
                summary: 'Festival International de Jazz de Montreal',
                description: undefined,
                url: undefined,
                start: new Date('2007-06-28T00:00:00.000Z'),
                allDay: true
            });

            expect(content).toBe([
                'BEGIN:VCALENDAR',
                'VERSION:2.0',
                'PRODID:-//Zibri//Zibri//EN',
                'CALSCALE:GREGORIAN',
                'BEGIN:VEVENT',
                'UID:20070423T123432Z-541111@example.com',
                'DTSTAMP:20070423T123432Z',
                'DTSTART;VALUE=DATE:20070628',
                'DTEND;VALUE=DATE:20070629',
                'SUMMARY:Festival International de Jazz de Montreal',
                'TRANSP:TRANSPARENT',
                'END:VEVENT',
                'END:VCALENDAR',
                ''
            ].join('\r\n'));
        });

        it('takes the day of a whole day event in UTC, and ends a month and a year on the day after', () => {
            const content: string = ICalendarUtilities.writeEvent({
                uid: 'task-1',
                stampedAt: new Date('2026-11-26T10:00:00.000Z'),
                summary: 'Close the year',
                description: undefined,
                url: undefined,
                start: new Date('2026-12-31T00:00:00.000Z'),
                allDay: true
            });

            expect(unfold(content)).toEqual(expect.arrayContaining(['DTSTART;VALUE=DATE:20261231', 'DTEND;VALUE=DATE:20270101']));
        });

        it('writes an event at a moment in UTC without an end, with its description and link escaped and folded', () => {
            const description: string = 'Send the filing, see the checklist; then tell Ada.\n\nhttps://app.example.com/tasks/1';

            const content: string = ICalendarUtilities.writeEvent({
                uid: 'task-0b3c1a2e-7f4d-4c8e-9a1b-2c3d4e5f6a7b',
                stampedAt: new Date('2026-11-26T10:15:30.250Z'),
                summary: 'Umsatzsteuer-Voranmeldung, Q3',
                description,
                url: 'https://app.example.com/tasks/1?from=calendar',
                start: new Date('2026-07-31T07:00:00.000Z'),
                allDay: false
            });

            expect(content.endsWith('\r\n')).toBe(true);
            expect(content.split('\r\n').every(line => Buffer.byteLength(line, 'utf8') <= 75)).toBe(true);
            expect(content.replaceAll('\r\n', '')).not.toContain('\n');
            expect(unfold(content)).toEqual([
                'BEGIN:VCALENDAR',
                'VERSION:2.0',
                'PRODID:-//Zibri//Zibri//EN',
                'CALSCALE:GREGORIAN',
                'BEGIN:VEVENT',
                'UID:task-0b3c1a2e-7f4d-4c8e-9a1b-2c3d4e5f6a7b',
                'DTSTAMP:20261126T101530Z',
                'DTSTART:20260731T070000Z',
                'SUMMARY:Umsatzsteuer-Voranmeldung\\, Q3',
                'DESCRIPTION:Send the filing\\, see the checklist\\; then tell Ada.\\n\\nhttps://app.example.com/tasks/1',
                'URL:https://app.example.com/tasks/1?from=calendar',
                'TRANSP:TRANSPARENT',
                'END:VEVENT',
                'END:VCALENDAR'
            ]);
        });

        it('encodes a url where a url needs it, and refuses one that is not absolute', () => {
            const event: Parameters<typeof ICalendarUtilities.writeEvent>[0] = {
                uid: 'task-1',
                stampedAt: new Date('2026-11-26T10:00:00.000Z'),
                summary: 'Review',
                description: undefined,
                url: 'https://app.example.com/tasks/Müller Review',
                start: new Date('2026-07-31T07:00:00.000Z'),
                allDay: false
            };

            expect(unfold(ICalendarUtilities.writeEvent(event))).toContain('URL:https://app.example.com/tasks/M%C3%BCller%20Review');
            expect(() => ICalendarUtilities.writeEvent({ ...event, url: '/tasks/1' })).toThrow('needs to be an absolute url');
        });
    });
});