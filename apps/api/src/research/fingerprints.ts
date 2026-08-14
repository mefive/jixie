import { createHash } from 'node:crypto';
import type {
  ResearchDataInputFingerprintV1,
  ResearchProtocolDefinitionV1,
  ResearchRunFingerprintsV1,
} from '@jixie/shared';

export function researchDataInputFingerprint(args: {
  inputId: string;
  payload: unknown;
  observations: number;
  firstDate: string | null;
  lastDate: string | null;
  dataRevision?: number;
}): ResearchDataInputFingerprintV1 {
  return {
    inputId: args.inputId,
    hash: researchPayloadHash(args.payload),
    observations: args.observations,
    firstDate: args.firstDate,
    lastDate: args.lastDate,
    ...(args.dataRevision === undefined ? {} : { dataRevision: args.dataRevision }),
  };
}

export function researchRunFingerprints(
  protocol: ResearchProtocolDefinitionV1,
  inputs: ResearchDataInputFingerprintV1[],
  environment: {
    appRevision?: string;
    nodeVersion?: string;
    platform?: string;
    architecture?: string;
  } = {},
): ResearchRunFingerprintsV1 {
  const appRevision = environment.appRevision ?? process.env.JIXIE_APP_REVISION ?? 'development';
  const nodeVersion = environment.nodeVersion ?? process.version;
  const platform = environment.platform ?? process.platform;
  const architecture = environment.architecture ?? process.arch;
  const sortedInputs = [...inputs].sort((left, right) => left.inputId.localeCompare(right.inputId));
  const protocolIdentity = { protocol, appRevision };
  const environmentIdentity = { nodeVersion, platform, architecture };

  return {
    version: 1,
    protocol: {
      id: protocol.id,
      version: protocol.version,
      appRevision,
      implementationHash: researchPayloadHash(protocolIdentity),
    },
    data: {
      hash: researchPayloadHash(sortedInputs),
      inputs: sortedInputs,
    },
    environment: {
      hash: researchPayloadHash(environmentIdentity),
      ...environmentIdentity,
    },
  };
}

export function researchPayloadHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}
