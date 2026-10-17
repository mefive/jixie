import type {
  ResearchSdkFunctionContractV1,
  ResearchSdkParameterContractV1,
  ResearchSdkReturnContractV1,
} from './contract.js';

/**
 * 根据公开契约构造 Python 完整签名，处理关键字边界与返回类型。
 * Render a complete Python signature with keyword boundaries and return types.
 */
export function renderResearchSdkPythonSignature(contract: ResearchSdkFunctionContractV1): string {
  const parameters: string[] = [];
  let keywordOnlyStarted = false;
  for (const parameter of contract.parameters) {
    if (parameter.keywordOnly && !keywordOnlyStarted) {
      parameters.push('*');
      keywordOnlyStarted = true;
    }
    parameters.push(renderResearchSdkPythonParameter(parameter));
  }
  return `${contract.qualifiedName}(${parameters.join(', ')}) -> ${researchSdkPythonReturnType(
    contract.returns,
  )}`;
}

/**
 * 按公开参数定义渲染 Python 签名，保留默认值与可选性。
 * Render a Python parameter from its public type, default and optionality.
 */
export function renderResearchSdkPythonParameter(
  parameter: ResearchSdkParameterContractV1,
): string {
  let pythonType = researchSdkPythonParameterType(parameter);
  if (parameter.defaultValue === null) {
    pythonType = `${pythonType} | None`;
  }
  if (parameter.defaultValue === undefined) {
    return `${parameter.name}: ${pythonType}`;
  }
  const defaultValue =
    parameter.defaultValue === null ? 'None' : JSON.stringify(parameter.defaultValue);
  return `${parameter.name}: ${pythonType} = ${defaultValue}`;
}

/**
 * 将 SDK 参数类型映射为 Python 标注，供 stub 与编辑器共用。
 * Map SDK parameter types to Python annotations shared by stubs and editor hints.
 */
export function researchSdkPythonParameterType(parameter: ResearchSdkParameterContractV1): string {
  switch (parameter.type) {
    case 'enum':
      return `Literal[${parameter.values!.map((value) => JSON.stringify(value)).join(', ')}]`;
    case 'string':
    case 'date':
      return 'str';
    case 'integer':
      return 'int';
    case 'number':
      return 'float';
    case 'dataframe':
      return 'pd.DataFrame';
    case 'string_or_string_list':
      if (parameter.values) {
        const literal = `Literal[${parameter.values
          .map((value) => JSON.stringify(value))
          .join(', ')}]`;
        return `${literal} | list[${literal}]`;
      }
      return 'str | list[str]';
    case 'string_map':
      return 'Mapping[str, str]';
  }
}

/**
 * 从公开返回种类选择 Python 返回标注。
 * Resolve Python return annotations from the public result kind.
 */
export function researchSdkPythonReturnType(contract: ResearchSdkReturnContractV1): string {
  switch (contract.kind) {
    case 'dataframe':
      return 'pd.DataFrame';
    case 'mapping':
      return contract.pythonType;
    case 'chart':
      return '_ChartResult';
  }
}
