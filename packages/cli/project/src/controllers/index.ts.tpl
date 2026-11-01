export * from './auth.controller';
export * from './health.controller';
{{#pages}}
export * from './page.controller';
{{/pages}}
{{#mailingList}}
export * from './mailing-list.controller';
{{/mailingList}}
