import { $ts, inject, LogEmailTemplate, LogLevel, MjColumn, MjSection, MjText, ZIBRI_DI_TOKENS } from 'zibri';

import { BaseEmail } from '../email-components/base-email';
import { BaseEmailDataListItem } from '../email-components/base-email-data-list-item';
import { BaseEmailFooter } from '../email-components/base-email-footer';
import { BaseEmailHeader } from '../email-components/base-email-header';
import { EmailWrapper } from '../email-components/email-wrapper';

const logLevelBgColors: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: '#00b4d8',
    [LogLevel.INFO]: '#00b4d8',
    [LogLevel.WARN]: '#edff4aff',
    [LogLevel.ERROR]: '#ff5959ff',
    [LogLevel.CRITICAL]: '#cc6cffff'
};

export const LogEmail: LogEmailTemplate = ({ logs }) => {
    const logLevelLabels: Record<LogLevel, string> = {
        [LogLevel.DEBUG]: $ts`Debug Log`,
        [LogLevel.INFO]: $ts`Info Log`,
        [LogLevel.WARN]: $ts`Warning`,
        [LogLevel.ERROR]: $ts`Error`,
        [LogLevel.CRITICAL]: $ts`Critical Error`
    };
    const mostSevere: LogLevel = Math.max(LogLevel.DEBUG, ...logs.map(log => log.level));
    const title: string = logLevelLabels[mostSevere];

    return (
        <BaseEmail title={title}>
            <EmailWrapper backgroundColor='#1a1a26' borderRadius='5px' boxShadow='0 0 8px 4px rgba(0, 0, 0, 0.15)'>
                <BaseEmailHeader>{title}</BaseEmailHeader>

                <MjSection paddingBottom='0px'>
                    <MjColumn>
                        <MjText>{$ts`The application recorded the following`}:</MjText>
                    </MjColumn>
                </MjSection>

                {logs.map(log => <>
                    <MjSection backgroundColor={logLevelBgColors[log.level]} paddingBottom='0px'>
                        <MjColumn>
                            <MjText color='black' fontWeight='bold'>{logLevelLabels[log.level]}</MjText>
                            <MjText color='black'>{log.message}</MjText>
                        </MjColumn>
                    </MjSection>

                    <BaseEmailDataListItem
                        backgroundColor={logLevelBgColors[log.level]}
                        color='black'
                        label={$ts`ID`}
                        value={log.id}
                    />
                    <BaseEmailDataListItem
                        backgroundColor={logLevelBgColors[log.level]}
                        color='black'
                        label={$ts`Time`}
                        value={inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).formatDate(log.createdAt, 'date-time')}
                    />
                    <BaseEmailDataListItem
                        backgroundColor={logLevelBgColors[log.level]}
                        color='black'
                        label={$ts`Origin`}
                        value={log.context.origin}
                        twoRows
                    />

                    {log.context.request && <>
                        <MjSection backgroundColor={logLevelBgColors[log.level]} paddingTop='20px' paddingBottom='0px'>
                            <MjColumn>
                                <MjText color='black' fontWeight='bold'>{$ts`Request`}</MjText>
                            </MjColumn>
                        </MjSection>
                        <BaseEmailDataListItem
                            backgroundColor={logLevelBgColors[log.level]}
                            color='black'
                            label={$ts`Method`}
                            value={log.context.request.method}
                        />
                        <BaseEmailDataListItem
                            backgroundColor={logLevelBgColors[log.level]}
                            color='black'
                            label={$ts`URL`}
                            value={log.context.request.url}
                        />
                        <BaseEmailDataListItem
                            backgroundColor={logLevelBgColors[log.level]}
                            color='black'
                            label={$ts`Client IP`}
                            value={log.context.request.clientIp}
                        />
                        <BaseEmailDataListItem
                            backgroundColor={logLevelBgColors[log.level]}
                            color='black'
                            label={$ts`User Agent`}
                            value={log.context.request.userAgent}
                        />
                    </>}

                    {log.context.error && <>
                        <MjSection backgroundColor={logLevelBgColors[log.level]} paddingTop='20px' paddingBottom='0px'>
                            <MjColumn>
                                <MjText color='black' fontWeight='bold'>{$ts`Error`}</MjText>
                            </MjColumn>
                        </MjSection>
                        <BaseEmailDataListItem
                            backgroundColor={logLevelBgColors[log.level]}
                            color='black'
                            label={$ts`Name`}
                            value={log.context.error.name}
                        />
                        <BaseEmailDataListItem
                            backgroundColor={logLevelBgColors[log.level]}
                            color='black'
                            label={$ts`Message`}
                            value={log.context.error.paragraphs}
                            twoRows
                        />
                        <BaseEmailDataListItem
                            backgroundColor={logLevelBgColors[log.level]}
                            color='black'
                            label={$ts`Stack Trace`}
                            value={log.context.error.stackTrace}
                            twoRows
                        />
                    </>}
                </>)}

                <BaseEmailFooter/>
            </EmailWrapper>
        </BaseEmail>
    );
};