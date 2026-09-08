import { prisma } from '../../infra/database/prisma.js';

export async function readResearchArtifact(userId: string, artifactId: string) {
  return await prisma.researchArtifact.findFirst({
    where: {
      id: artifactId,
      document: { userId },
    },
    select: { data: true, mimeType: true, byteSize: true, sha256: true },
  });
}
