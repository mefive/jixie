import {
  RESEARCH_SDK_CONTRACT_V1,
  type ResearchSdkContractV1,
  type ResearchSdkFunctionContractV1,
} from './research-sdk-contract.js';
import { renderResearchSdkPythonSignature } from './research-sdk-python-signature.js';

export interface ResearchSdkAgentMethodV1 extends ResearchSdkFunctionContractV1 {
  kind: 'sdk_method';
  contractVersion: 1;
  runtimeVersion: 'research-py-v1';
  signature: string;
}

export interface ResearchSdkAgentCatalogV1 {
  version: 1;
  runtimeVersion: 'research-py-v1';
  methods: readonly ResearchSdkAgentMethodV1[];
}

export function createResearchSdkAgentCatalog(
  contract: ResearchSdkContractV1 = RESEARCH_SDK_CONTRACT_V1,
): ResearchSdkAgentCatalogV1 {
  return {
    version: 1,
    runtimeVersion: contract.runtimeVersion,
    methods: contract.functions.map((method) => ({
      kind: 'sdk_method',
      contractVersion: contract.version,
      runtimeVersion: contract.runtimeVersion,
      ...method,
      signature: renderResearchSdkPythonSignature(method),
    })),
  };
}

export const RESEARCH_SDK_AGENT_CATALOG_V1 = createResearchSdkAgentCatalog();

export function searchResearchSdkAgentCatalog(
  text: string | undefined,
  catalog: ResearchSdkAgentCatalogV1 = RESEARCH_SDK_AGENT_CATALOG_V1,
): ResearchSdkAgentMethodV1[] {
  const query = text?.trim().toLocaleLowerCase();
  if (!query) {
    return [];
  }
  const terms = [...query.matchAll(/[a-z_]+(?:\.[a-z_]+)?|[\p{Script=Han}]+/gu)]
    .map((match) => match[0])
    .filter(
      (term) =>
        !SDK_QUERY_STOP_WORDS.has(term) &&
        (/^[\p{Script=Han}]+$/u.test(term) ? term.length >= 2 : term.length >= 3),
    );
  if (terms.length === 0) {
    return [];
  }

  return catalog.methods
    .map((method, index) => ({ method, index, score: sdkMethodSearchScore(method, query, terms) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((candidate) => candidate.method);
}

const SDK_QUERY_STOP_WORDS = new Set([
  'api',
  'method',
  'python',
  'research',
  'sdk',
  '接口',
  '方法',
  '研究',
]);

function sdkMethodSearchScore(
  method: ResearchSdkAgentMethodV1,
  query: string,
  terms: string[],
): number {
  const qualifiedName = method.qualifiedName.toLocaleLowerCase();
  const name = method.name.toLocaleLowerCase();
  if (query === qualifiedName) {
    return 100;
  }
  if (query === name) {
    return 80;
  }
  if (query.includes(qualifiedName)) {
    return 60;
  }

  const searchable = [
    qualifiedName,
    name,
    method.namespace.toLocaleLowerCase(),
    method.descriptionZh.toLocaleLowerCase(),
    method.descriptionEn.toLocaleLowerCase(),
  ];
  return terms.reduce((score, term) => {
    if (term === qualifiedName) {
      return score + 50;
    }
    if (term === name) {
      return score + 30;
    }
    return score + (searchable.some((value) => value.includes(term)) ? 5 : 0);
  }, 0);
}
