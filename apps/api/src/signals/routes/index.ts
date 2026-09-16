import { Hono } from 'hono';
import { signalDeploymentRoute } from './deployment.js';
import { signalRunRoute } from './run.js';
import { signalExecutionRoute } from './execution.js';

export const signalsRoute = new Hono()
  .route('/', signalDeploymentRoute)
  .route('/', signalRunRoute)
  .route('/', signalExecutionRoute);
