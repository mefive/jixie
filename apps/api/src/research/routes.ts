import { Hono } from 'hono';
import { researchDocumentRoute } from './document-routes.js';
import { researchExecutionRoute } from './execution-routes.js';
import { researchEvidenceRoute } from './evidence-routes.js';
import { researchProposalRoute } from './proposal-routes.js';
import { researchAgentRoute } from './agent-routes.js';
import { researchCuratorRoute } from './curator-routes.js';
import { researchDataRoute } from './data-routes.js';
import { researchLanguageRoute } from './language-routes.js';

export const researchRoute = new Hono();

researchRoute.route('/', researchDocumentRoute);
researchRoute.route('/', researchExecutionRoute);
researchRoute.route('/', researchEvidenceRoute);
researchRoute.route('/', researchProposalRoute);
researchRoute.route('/', researchAgentRoute);
researchRoute.route('/', researchCuratorRoute);
researchRoute.route('/', researchDataRoute);
researchRoute.route('/', researchLanguageRoute);
