import { githubPullRequests } from '@open-sync/examples/syncs/github';
import { gmailEmails } from '@open-sync/examples/syncs/gmail';
import { granolaMeetings } from '@open-sync/examples/syncs/granola';
import { slackMessages } from '@open-sync/examples/syncs/slack';

export const syncDefinitions = [githubPullRequests, gmailEmails, slackMessages, granolaMeetings];
