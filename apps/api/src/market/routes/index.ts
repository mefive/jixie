import { Hono } from 'hono';
import { marketInstrumentRoute } from './instrument.js';
import { marketValuationRoute } from './valuation.js';
import { marketStateRoute } from './state.js';

export const marketRoute = new Hono()
  .route('/', marketInstrumentRoute)
  .route('/', marketValuationRoute)
  .route('/', marketStateRoute);
