
export type MailConfig = {
    maxEmailsPerHour: number,
    host: string,
    port: number,
    auth: {
        user: string,
        pass: string
    }
};