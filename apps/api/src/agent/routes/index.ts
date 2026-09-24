import { Hono } from 'hono';
import { agentTurnRoute } from './turn.js';
import { agentChartRoute } from './chart.js';

export const agentRoute = new Hono().route('/', agentTurnRoute).route('/', agentChartRoute);
