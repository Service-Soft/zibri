import { Controller } from 'zibri';
import { MailingListController } from 'zibri/plugin/mailing-list';

// the links in the mails to a mailing list point at the path of this controller
@Controller('/mailing-lists', { versions: 'all' })
export class AppMailingListController extends MailingListController {}
