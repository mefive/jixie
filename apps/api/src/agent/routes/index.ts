import { Hono } from 'hono';
import { agentConversationRoute } from './conversation.js';
import { agentTurnRoute } from './turn.js';
import { agentChartRoute } from './chart.js';

export const agentRoute = new Hono()
  .route('/', agentConversationRoute)
  .route('/', agentTurnRoute)
  .route('/', agentChartRoute);
