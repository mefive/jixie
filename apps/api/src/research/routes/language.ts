import { validateJson } from '#infra/http/errors.js';
import { Hono } from 'hono';
import { researchPythonLanguageService } from '../language/pyright-service.js';
import { pythonLanguageRequestSchema } from '@jixie/shared/api/research';

export const researchLanguageRoute = new Hono();

researchLanguageRoute.post(
  '/language/python',
  validateJson(pythonLanguageRequestSchema),
  async (c) => {
    const request = c.req.valid('json');

    return c.json(
      await researchPythonLanguageService.request(`${c.var.userId}:${request.documentId}`, request),
    );
  },
);
