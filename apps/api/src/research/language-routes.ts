import { Hono } from 'hono';
import { z } from 'zod';
import { apiError, validateJson } from '#infra/http/errors.js';
import { m } from '#infra/http/locale.js';
import { researchPythonLanguageService } from './language/pyright-service.js';

export const researchLanguageRoute = new Hono();

const languagePosition = z.strictObject({
  line: z.number().int().min(0).max(100_000),
  character: z.number().int().min(0).max(100_000),
});

const languageRequestBody = z
  .strictObject({
    version: z.literal(1),
    documentId: z.string().min(1).max(80),
    cells: z
      .array(
        z.strictObject({
          id: z.string().min(1).max(80),
          source: z.string().max(100_000),
        }),
      )
      .max(100),
    cellId: z.string().min(1).max(80),
    action: z.enum([
      'completion',
      'hover',
      'signature_help',
      'definition',
      'references',
      'prepare_rename',
      'rename',
      'diagnostics',
    ]),
    position: languagePosition.optional(),
    newName: z
      .string()
      .regex(/^[A-Za-z_]\w*$/)
      .max(120)
      .optional(),
  })
  .superRefine((value, context) => {
    if (value.cells.reduce((total, cell) => total + cell.source.length, 0) > 500_000) {
      context.addIssue({
        code: 'custom',
        path: ['cells'],
        message: 'Document source is too large',
      });
    }
    if (!value.cells.some((cell) => cell.id === value.cellId)) {
      context.addIssue({
        code: 'custom',
        path: ['cellId'],
        message: 'Cell is not in the document',
      });
    }
    if (value.action !== 'diagnostics' && !value.position) {
      context.addIssue({ code: 'custom', path: ['position'], message: 'Position is required' });
    }
    if (value.action === 'rename' && !value.newName) {
      context.addIssue({ code: 'custom', path: ['newName'], message: 'New name is required' });
    }
  });

researchLanguageRoute.post('/language/python', validateJson(languageRequestBody), async (c) => {
  const request = c.req.valid('json');
  try {
    return c.json(
      await researchPythonLanguageService.request(`${c.var.userId}:${request.documentId}`, request),
    );
  } catch (error) {
    console.error('[jixie] Research Python language service request failed', error);
    return apiError(c, 'SERVICE_UNAVAILABLE', m(c, 'researchLanguageServiceUnavailable'));
  }
});
