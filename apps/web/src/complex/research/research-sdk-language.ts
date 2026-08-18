import { RESEARCH_SDK_CONTRACT_V1, type ResearchSdkFunctionContractV1 } from '@jixie/shared';

export type ResearchSdkCompletionContext =
  | { kind: 'namespace_member'; namespace: string; partial: string }
  | {
      kind: 'parameter_name';
      contract: ResearchSdkFunctionContractV1;
      partial: string;
      usedParameters: Set<string>;
    }
  | {
      kind: 'parameter_value';
      contract: ResearchSdkFunctionContractV1;
      parameterName: string;
      partial: string;
      frameVariable?: string;
    }
  | {
      kind: 'dataframe_column';
      variableName: string;
      partial: string;
      contract: ResearchSdkFunctionContractV1;
    };

export interface ResearchSdkActiveCall {
  contract: ResearchSdkFunctionContractV1;
  argumentSource: string;
  activeParameter: number;
}

export function researchSdkCompletionContext(
  source: string,
  offset: number,
): ResearchSdkCompletionContext | null {
  const prefix = source.slice(0, offset);
  const bindings = researchSdkDataFrameBindings(prefix);
  const columnMatch = prefix.match(/\b([A-Za-z_]\w*)\s*\[\s*(['"])([^'"]*)$/);
  if (columnMatch) {
    const contract = bindings.get(columnMatch[1]);
    if (contract) {
      return {
        kind: 'dataframe_column',
        variableName: columnMatch[1],
        partial: columnMatch[3],
        contract,
      };
    }
  }

  const activeCall = researchSdkActiveCall(source, offset);
  if (activeCall) {
    const valueMatch = activeCall.argumentSource.match(/\b([A-Za-z_]\w*)\s*=\s*(['"])([^'"]*)$/);
    if (valueMatch) {
      const frameVariable = researchSdkFrameVariable(activeCall.argumentSource);
      return {
        kind: 'parameter_value',
        contract: activeCall.contract,
        parameterName: valueMatch[1],
        partial: valueMatch[3],
        ...(frameVariable ? { frameVariable } : {}),
      };
    }

    const parameterMatch = activeCall.argumentSource.match(/(?:^|,)\s*([A-Za-z_]\w*)?$/);
    if (parameterMatch) {
      return {
        kind: 'parameter_name',
        contract: activeCall.contract,
        partial: parameterMatch[1] ?? '',
        usedParameters: new Set(
          [...activeCall.argumentSource.matchAll(/\b([A-Za-z_]\w*)\s*=/g)].map((match) => match[1]),
        ),
      };
    }
  }

  const memberMatch = prefix.match(/\b(data|charts)\.([A-Za-z_]\w*)?$/);
  if (memberMatch) {
    return {
      kind: 'namespace_member',
      namespace: memberMatch[1],
      partial: memberMatch[2] ?? '',
    };
  }
  return null;
}

export function researchSdkDataFrameBindings(
  source: string,
): Map<string, ResearchSdkFunctionContractV1> {
  const bindings = new Map<string, ResearchSdkFunctionContractV1>();
  for (const contract of RESEARCH_SDK_CONTRACT_V1.functions) {
    if (contract.returns.kind !== 'dataframe') {
      continue;
    }
    const escapedName = contract.qualifiedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const assignment = new RegExp(`^\\s*([A-Za-z_]\\w*)\\s*=\\s*${escapedName}\\s*\\(`, 'gm');
    for (const match of source.matchAll(assignment)) {
      const openParenthesis = match.index + match[0].lastIndexOf('(');
      const closeParenthesis = matchingClosingParenthesis(source, openParenthesis);
      if (closeParenthesis < 0) {
        continue;
      }
      const restOfLine = source.slice(closeParenthesis + 1).split('\n', 1)[0];
      if (/^\s*(?:#.*)?$/.test(restOfLine)) {
        bindings.set(match[1], contract);
      }
    }
  }
  return bindings;
}

export function researchSdkActiveCall(
  source: string,
  offset: number,
): ResearchSdkActiveCall | null {
  const prefix = source.slice(0, offset);
  let active: ResearchSdkActiveCall | null = null;
  for (const contract of RESEARCH_SDK_CONTRACT_V1.functions) {
    const escapedName = contract.qualifiedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const call = new RegExp(`\\b${escapedName}\\s*\\(`, 'g');
    for (const match of prefix.matchAll(call)) {
      const openParenthesis = match.index + match[0].lastIndexOf('(');
      const argumentSource = prefix.slice(openParenthesis + 1);
      if (!callRemainsOpen(prefix, openParenthesis)) {
        continue;
      }
      active = {
        contract,
        argumentSource,
        activeParameter: activeParameterIndex(argumentSource, contract),
      };
    }
  }
  return active;
}

export function researchSdkHoverContract(
  source: string,
  offset: number,
): ResearchSdkFunctionContractV1 | null {
  for (const contract of RESEARCH_SDK_CONTRACT_V1.functions) {
    let start = source.indexOf(contract.qualifiedName);
    while (start >= 0) {
      const end = start + contract.qualifiedName.length;
      if (offset >= start && offset <= end) {
        return contract;
      }
      start = source.indexOf(contract.qualifiedName, end);
    }
  }
  return null;
}

function researchSdkFrameVariable(argumentSource: string): string | undefined {
  const named = argumentSource.match(/\bframe\s*=\s*([A-Za-z_]\w*)/);
  if (named) {
    return named[1];
  }
  return argumentSource.match(/^\s*([A-Za-z_]\w*)\s*(?:,|$)/)?.[1];
}

function callRemainsOpen(prefix: string, openParenthesis: number): boolean {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let index = openParenthesis; index < prefix.length; index++) {
    const character = prefix[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '(' || character === '[' || character === '{') {
      depth += 1;
    } else if (character === ')' || character === ']' || character === '}') {
      depth -= 1;
      if (depth === 0) {
        return false;
      }
    }
  }
  return depth > 0;
}

function matchingClosingParenthesis(source: string, openParenthesis: number): number {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let index = openParenthesis; index < source.length; index++) {
    const character = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function activeParameterIndex(
  argumentSource: string,
  contract: ResearchSdkFunctionContractV1,
): number {
  const namedParameter = argumentSource.match(/\b([A-Za-z_]\w*)\s*=\s*[^,]*$/s)?.[1];
  const namedIndex = contract.parameters.findIndex(
    (parameter) => parameter.name === namedParameter,
  );
  if (namedIndex >= 0) {
    return namedIndex;
  }

  let commas = 0;
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (const character of argumentSource) {
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '(' || character === '[' || character === '{') {
      depth += 1;
    } else if (character === ')' || character === ']' || character === '}') {
      depth -= 1;
    } else if (character === ',' && depth === 0) {
      commas += 1;
    }
  }
  return Math.min(commas, contract.parameters.length - 1);
}
