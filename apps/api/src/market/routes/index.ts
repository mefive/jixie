import { Hono } from 'hono';
import { marketInstrumentRoute } from './instrument.js';
import { marketValuationRoute } from './valuation.js';

export const marketRoute = new Hono()
  .route('/', marketInstrumentRoute)
  .route('/', marketValuationRoute);
