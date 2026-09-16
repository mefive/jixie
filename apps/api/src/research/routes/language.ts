import { pythonLanguageRequestSchema } from '../schema.js';
import { Hono } from 'hono';
import { apiError, validateJson } from '#infra/http/errors.js';
import { m } from '#infra/http/locale.js';
import { researchPythonLanguageService } from '../language/pyright-service.js';

export const researchLanguageRoute = new Hono();

researchLanguageRoute.post(
  '/language/python',
  validateJson(pythonLanguageRequestSchema),
  async (c) => {
    const request = c.req.valid('json');
    try {
      return c.json(
        await researchPythonLanguageService.request(
          `${c.var.userId}:${request.documentId}`,
          request,
        ),
      );
    } catch (error) {
      console.error('[jixie] Research Python language service request failed', error);
      return apiError(c, 'SERVICE_UNAVAILABLE', m(c, 'researchLanguageServiceUnavailable'));
    }
  },
);
