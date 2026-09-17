import { prisma } from '#infra/database/prisma.js';
import { ResearchError } from '../errors.js';

export async function readResearchArtifact(userId: string, artifactId: string) {
  const artifact = await prisma.researchArtifact.findFirst({
    where: {
      id: artifactId,
      document: { userId },
    },
    select: { data: true, mimeType: true, byteSize: true, sha256: true },
  });
  if (!artifact) {
    throw new ResearchError('artifact_not_found');
  }
  return artifact;
}
