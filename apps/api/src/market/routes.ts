import { Hono } from 'hono';
import { marketInstrumentRoute } from './instrument-routes.js';
import { marketValuationRoute } from './valuation-routes.js';
import { marketStateRoute } from './state-routes.js';

export const marketRoute = new Hono()
  .route('/', marketInstrumentRoute)
  .route('/', marketValuationRoute)
  .route('/', marketStateRoute);
