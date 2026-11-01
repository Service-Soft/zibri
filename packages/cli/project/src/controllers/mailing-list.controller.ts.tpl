import { Controller, MailingListController } from 'zibri';

// the links in the mails to a mailing list point at the path of this controller
@Controller('/mailing-lists', { versions: 'all' })
export class AppMailingListController extends MailingListController {}
