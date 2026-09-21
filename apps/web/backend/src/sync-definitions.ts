import { githubPullRequests } from '@open-sync/examples/syncs/github';
import { gmailThreads } from '@open-sync/examples/syncs/gmail';
import { granolaMeetings } from '@open-sync/examples/syncs/granola';
import { slackThreads } from '@open-sync/examples/syncs/slack';

export const syncDefinitions = [githubPullRequests, gmailThreads, slackThreads, granolaMeetings];
