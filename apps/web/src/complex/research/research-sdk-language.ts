import { RESEARCH_SDK_CONTRACT_V1, type ResearchSdkFunctionContractV1 } from '@jixie/shared';

const researchSdkNamespacePattern = [
  ...new Set(RESEARCH_SDK_CONTRACT_V1.functions.map((item) => item.namespace)),
].join('|');

/**
 * 描述光标所在 SDK 名称空间、方法或参数，供补全分派。
 *
 * Describe SDK namespace, method or argument context for completion.
 */
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
      argumentSource: string;
    }
  | {
      kind: 'dataframe_column';
      variableName: string;
      partial: string;
      contract: ResearchSdkFunctionContractV1;
    };

/**
 * 保留未结束调用的参数文本与位置，供签名帮助。
 *
 * Describe arguments and positions in an active unfinished SDK call.
 */
export interface ResearchSdkActiveCall {
  contract: ResearchSdkFunctionContractV1;
  argumentSource: string;
  activeParameter: number;
}

/**
 * 解析光标前的命名空间、方法与字符串位置，供 SDK 补全分派。
 *
 * Resolve namespace, method and string context before the cursor for SDK completion.
 */
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
        argumentSource: activeCall.argumentSource,
        ...(frameVariable ? { frameVariable } : {}),
      };
    }

    const activeArgument = splitTopLevelArguments(activeCall.argumentSource).at(-1)?.trim() ?? '';
    const positionalValueMatch = activeArgument.match(/^(["'])([^"']*)$/);
    const positionalParameter = activeCall.contract.parameters[activeCall.activeParameter];
    if (positionalValueMatch && positionalParameter) {
      return {
        kind: 'parameter_value',
        contract: activeCall.contract,
        parameterName: positionalParameter.name,
        partial: positionalValueMatch[2],
        argumentSource: activeCall.argumentSource,
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

  const memberMatch = prefix.match(
    new RegExp(`\\b(${researchSdkNamespacePattern})\\.([A-Za-z_]\\w*)?$`),
  );
  if (memberMatch) {
    return {
      kind: 'namespace_member',
      namespace: memberMatch[1],
      partial: memberMatch[2] ?? '',
    };
  }
  return null;
}

/**
 * 静态识别 SDK DataFrame 变量绑定，供列名补全。
 *
 * Identify SDK DataFrame variable bindings for column completion.
 */
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

/**
 * 解析尚未结束的 SDK 调用及当前参数，供签名帮助。
 *
 * Resolve the active unfinished SDK call and current argument.
 */
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

/**
 * 定位光标下公开 SDK 契约，供 hover 文档查询。
 *
 * Locate the public SDK contract at the cursor for hover documentation.
 */
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

/**
 * 从当前调用读取已完成字符串参数，兼容位置参数与具名参数。
 *
 * Read a completed string argument from the active SDK call, whether positional or named.
 */
export function researchSdkStringArgument(
  argumentSource: string,
  contract: ResearchSdkFunctionContractV1,
  parameterName: string,
): string | undefined {
  const escapedName = parameterName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const named = argumentSource.match(new RegExp(`\\b${escapedName}\\s*=\\s*(["'])([^"']*)\\1`));
  if (named) {
    return named[2];
  }

  const parameterIndex = contract.parameters.findIndex(
    (parameter) => parameter.name === parameterName,
  );
  if (parameterIndex < 0) {
    return undefined;
  }
  const positional = splitTopLevelArguments(argumentSource).filter(
    (argument) => !argument.includes('='),
  );
  const literal = positional[parameterIndex]?.trim().match(/^(["'])([^"']*)\1$/);
  return literal?.[2];
}

function researchSdkFrameVariable(argumentSource: string): string | undefined {
  const named = argumentSource.match(/\bframe\s*=\s*([A-Za-z_]\w*)/);
  if (named) {
    return named[1];
  }
  return argumentSource.match(/^\s*([A-Za-z_]\w*)\s*(?:,|$)/)?.[1];
}

/**
 * 按顶层逗号拆分参数，同时跳过字符串和嵌套括号。
 *
 * Split top-level arguments while respecting strings and nested parentheses.
 */
function splitTopLevelArguments(source: string): string[] {
  const argumentsList: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let index = 0; index < source.length; index++) {
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
    } else if (character === '(' || character === '[' || character === '{') {
      depth += 1;
    } else if (character === ')' || character === ']' || character === '}') {
      depth -= 1;
    } else if (character === ',' && depth === 0) {
      argumentsList.push(source.slice(start, index));
      start = index + 1;
    }
  }
  argumentsList.push(source.slice(start));
  return argumentsList;
}

/**
 * 判断调用括号在光标前是否仍未关闭，供补全上下文。
 *
 * Determine whether a call remains open before the cursor.
 */
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

/**
 * 查找对应右括号，忽略字符串和嵌套调用中的括号。
 *
 * Find the matching closing parenthesis while respecting strings and nested calls.
 */
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

/**
 * 根据位置和关键字参数确定公开契约中的当前参数索引。
 *
 * Resolve the active contract parameter from positional and keyword arguments.
 */
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
