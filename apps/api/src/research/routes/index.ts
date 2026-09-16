import { Hono } from 'hono';
import { researchDocumentRoute } from './document.js';
import { researchExecutionRoute } from './execution.js';
import { researchEvidenceRoute } from './evidence.js';
import { researchProposalRoute } from './proposal.js';
import { researchAgentRoute } from './agent.js';
import { researchCuratorRoute } from './curator.js';
import { researchDataRoute } from './data.js';
import { researchLanguageRoute } from './language.js';
import { researchEmbeddedRoute } from './embedded.js';

export const researchRoute = new Hono();

researchRoute.route('/embedded-analyses', researchEmbeddedRoute);

researchRoute.route('/', researchDocumentRoute);
researchRoute.route('/', researchExecutionRoute);
researchRoute.route('/', researchEvidenceRoute);
researchRoute.route('/', researchProposalRoute);
researchRoute.route('/', researchAgentRoute);
researchRoute.route('/', researchCuratorRoute);
researchRoute.route('/', researchDataRoute);
researchRoute.route('/', researchLanguageRoute);
