import { Hono } from 'hono';
import { agentConversationRoute } from './conversation-routes.js';
import { agentTurnRoute } from './turn-routes.js';
import { agentChartRoute } from './chart-routes.js';

export const agentRoute = new Hono()
  .route('/', agentConversationRoute)
  .route('/', agentTurnRoute)
  .route('/', agentChartRoute);
