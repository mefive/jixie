import { Hono } from 'hono';
import { agentTurnRoute } from './turn.js';

export const agentRoute = new Hono().route('/', agentTurnRoute);
