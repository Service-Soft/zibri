import { inject, LogLevel, ZIBRI_DI_TOKENS, LogEmailTemplate } from 'zibri';

import { BaseEmail } from '../email-components/base-email';
import { BaseEmailDataListItem } from '../email-components/base-email-data-list-item';
import { BaseEmailFooter } from '../email-components/base-email-footer';
import { BaseEmailHeader } from '../email-components/base-email-header';
import { EmailColumn } from '../email-components/email-column';
import { EmailSection } from '../email-components/email-section';
import { EmailText } from '../email-components/email-text';
import { EmailWrapper } from '../email-components/email-wrapper';

const logLevelLabels: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: 'Debug Log',
    [LogLevel.INFO]: 'Info Log',
    [LogLevel.WARN]: 'Warning',
    [LogLevel.ERROR]: 'Error',
    [LogLevel.CRITICAL]: 'Critical Error'
};

const logLevelBgColors: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: '#00b4d8',
    [LogLevel.INFO]: '#00b4d8',
    [LogLevel.WARN]: '#edff4aff',
    [LogLevel.ERROR]: '#ff5959ff',
    [LogLevel.CRITICAL]: '#cc6cffff'
};

export const LogEmail: LogEmailTemplate = ({ log }) => {
    const levelName: string = logLevelLabels[log.level];
    const boxBgColor: string = logLevelBgColors[log.level];
    const createdAtString: string = inject(ZIBRI_DI_TOKENS.FORMAT_DATE)(log.createdAt, true);

    return (
        <BaseEmail title={levelName}>
            <EmailWrapper backgroundColor='#1a1a26' borderRadius='5px' boxShadow='0 0 8px 4px rgba(0, 0, 0, 0.15)'>
                <BaseEmailHeader>{levelName}</BaseEmailHeader>

                <EmailSection>
                    <EmailColumn>
                        <EmailText>There has been a new log:</EmailText>
                    </EmailColumn>
                </EmailSection>

                {/* Content */}
                <EmailWrapper backgroundColor={boxBgColor} color='black' padding='15px' borderRadius='5px'>
                    <EmailSection title='Message'>
                        <EmailColumn>
                            <EmailText>{log.message}</EmailText>
                        </EmailColumn>
                    </EmailSection>

                    <EmailSection title='Details' paddingBottom={!log.context.error && !log.context.request ? '0px' : '20px'}>
                        <BaseEmailDataListItem label='ID' value={log.id}></BaseEmailDataListItem>
                        <BaseEmailDataListItem label='Time' value={createdAtString}></BaseEmailDataListItem>
                        <BaseEmailDataListItem label='Origin' value={log.context.origin} twoRows></BaseEmailDataListItem>
                    </EmailSection>

                    {log.context.request && <>
                        <EmailSection title='Request' paddingBottom={!log.context.error ? '0px' : '20px'}>
                            <BaseEmailDataListItem label='Method' value={log.context.request.method}></BaseEmailDataListItem>
                            <BaseEmailDataListItem label='URL' value={log.context.request.url}></BaseEmailDataListItem>
                            <BaseEmailDataListItem label='Client IP' value={log.context.request.clientIp}></BaseEmailDataListItem>
                            <BaseEmailDataListItem label='User Agent' value={log.context.request.userAgent}></BaseEmailDataListItem>
                        </EmailSection>
                    </>}

                    {log.context.error && <>
                        <EmailSection title='Error' paddingBottom='0px'>
                            <BaseEmailDataListItem label='Name' value={log.context.error.name}></BaseEmailDataListItem>
                            <BaseEmailDataListItem label='Message' value={log.context.error.paragraphs} twoRows></BaseEmailDataListItem>
                            <BaseEmailDataListItem label='Stack Trace' value={log.context.error.stackTrace} twoRows></BaseEmailDataListItem>
                        </EmailSection>
                    </>}
                </EmailWrapper>

                <BaseEmailFooter/>
            </EmailWrapper>
        </BaseEmail>
    );
};