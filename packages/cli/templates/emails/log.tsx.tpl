import { $ts, inject, LogEmailTemplate, LogLevel, MjColumn, MjSection, MjText, ZIBRI_DI_TOKENS } from 'zibri';

import { BaseEmail } from '../email-components/base-email';
import { BaseEmailDataListItem } from '../email-components/base-email-data-list-item';
import { BaseEmailFooter } from '../email-components/base-email-footer';
import { BaseEmailHeader } from '../email-components/base-email-header';
import { EmailWrapper } from '../email-components/email-wrapper';

export const LogEmail: LogEmailTemplate = ({ log }) => {
    const logLevelLabels: Record<LogLevel, string> = {
        [LogLevel.DEBUG]: $ts`Debug Log`,
        [LogLevel.INFO]: $ts`Info Log`,
        [LogLevel.WARN]: $ts`Warning`,
        [LogLevel.ERROR]: $ts`Error`,
        [LogLevel.CRITICAL]: $ts`Critical Error`
    };

    const logLevelBgColors: Record<LogLevel, string> = {
        [LogLevel.DEBUG]: '#00b4d8',
        [LogLevel.INFO]: '#00b4d8',
        [LogLevel.WARN]: '#edff4aff',
        [LogLevel.ERROR]: '#ff5959ff',
        [LogLevel.CRITICAL]: '#cc6cffff'
    };

    const levelName: string = logLevelLabels[log.level];
    const boxBgColor: string = logLevelBgColors[log.level];
    const createdAtString: string = inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).formatDate(log.createdAt, 'date-time');

    return (
        <BaseEmail title={levelName}>
            <EmailWrapper backgroundColor='#1a1a26' borderRadius='5px' boxShadow='0 0 8px 4px rgba(0, 0, 0, 0.15)'>
                <BaseEmailHeader>{levelName}</BaseEmailHeader>

                <MjSection paddingBottom='0px'>
                    <MjColumn>
                        <MjText>{$ts`There has been a new log`}:</MjText>
                    </MjColumn>
                </MjSection>

                <MjSection backgroundColor={boxBgColor} paddingBottom='0px'>
                    <MjColumn>
                        <MjText color='black' fontWeight='bold'>{$ts`Message`}</MjText>
                        <MjText color='black'>{log.message}</MjText>
                    </MjColumn>
                </MjSection>

                <MjSection backgroundColor={boxBgColor} paddingTop='0px' paddingBottom='0px'>
                    <MjColumn>
                        <MjText color='black' fontWeight='bold'>{$ts`Details`}</MjText>
                    </MjColumn>
                </MjSection>
                <BaseEmailDataListItem backgroundColor={boxBgColor} color='black' label={$ts`ID`} value={log.id}/>
                <BaseEmailDataListItem backgroundColor={boxBgColor} color='black' label={$ts`Time`} value={createdAtString}/>
                <BaseEmailDataListItem backgroundColor={boxBgColor} color='black' label={$ts`Origin`} value={log.context.origin} twoRows/>

                {log.context.request && <>
                    <MjSection backgroundColor={boxBgColor} paddingTop='20px' paddingBottom='0px'>
                        <MjColumn>
                            <MjText color='black' fontWeight='bold'>{$ts`Request`}</MjText>
                        </MjColumn>
                    </MjSection>
                    <BaseEmailDataListItem
                        backgroundColor={boxBgColor}
                        color='black'
                        label={$ts`Method`}
                        value={log.context.request.method}
                    />
                    <BaseEmailDataListItem
                        backgroundColor={boxBgColor}
                        color='black'
                        label={$ts`URL`}
                        value={log.context.request.url}
                    />
                    <BaseEmailDataListItem
                        backgroundColor={boxBgColor}
                        color='black'
                        label={$ts`Client IP`}
                        value={log.context.request.clientIp}
                    />
                    <BaseEmailDataListItem
                        backgroundColor={boxBgColor}
                        color='black'
                        label={$ts`User Agent`}
                        value={log.context.request.userAgent}
                    />
                </>}

                {log.context.error && <>
                    <MjSection backgroundColor={boxBgColor} paddingTop='20px' paddingBottom='0px'>
                        <MjColumn>
                            <MjText color='black' fontWeight='bold'>{$ts`Error`}</MjText>
                        </MjColumn>
                    </MjSection>
                    <BaseEmailDataListItem
                        backgroundColor={boxBgColor}
                        color='black'
                        label={$ts`Name`}
                        value={log.context.error.name}
                    />
                    <BaseEmailDataListItem
                        backgroundColor={boxBgColor}
                        color='black'
                        label={$ts`Message`}
                        value={log.context.error.paragraphs}
                        twoRows/>
                    <BaseEmailDataListItem
                        backgroundColor={boxBgColor}
                        color='black'
                        label={$ts`Stack Trace`}
                        value={log.context.error.stackTrace} twoRows
                    />
                </>}

                <BaseEmailFooter/>
            </EmailWrapper>
        </BaseEmail>
    );
};