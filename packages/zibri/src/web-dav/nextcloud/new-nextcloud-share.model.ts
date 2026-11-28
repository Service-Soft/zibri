import { NewNextcloudLinkShare } from './new-nextcloud-link-share.model';
import { NewNextcloudRecipientShare } from './new-nextcloud-recipient-share.model';

/**
 * A share of a file or a folder to create on Nextcloud: a link anyone who has it reads the file or the folder with,
 * or a share with a user or a group of the same Nextcloud.
 */
export type NewNextcloudShare = NewNextcloudLinkShare | NewNextcloudRecipientShare;