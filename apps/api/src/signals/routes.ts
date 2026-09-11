import { Hono } from 'hono';
import { signalDeploymentRoute } from './deployment-routes.js';
import { signalRunRoute } from './run-routes.js';
import { signalExecutionRoute } from './execution-routes.js';

export const signalsRoute = new Hono()
  .route('/', signalDeploymentRoute)
  .route('/', signalRunRoute)
  .route('/', signalExecutionRoute);
