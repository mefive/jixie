import type {
  ResearchSdkFunctionContractV1,
  ResearchSdkParameterContractV1,
  ResearchSdkReturnContractV1,
} from './research-sdk-contract.js';

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

export function researchSdkPythonParameterType(parameter: ResearchSdkParameterContractV1): string {
  switch (parameter.type) {
    case 'enum':
      return `Literal[${parameter.values!.map((value) => JSON.stringify(value)).join(', ')}]`;
    case 'string':
    case 'date':
      return 'str';
    case 'integer':
      return 'int';
    case 'dataframe':
      return 'pd.DataFrame';
    case 'string_or_string_list':
      return 'str | list[str]';
    case 'string_map':
      return 'Mapping[str, str]';
  }
}

export function researchSdkPythonReturnType(contract: ResearchSdkReturnContractV1): string {
  return contract.kind === 'dataframe' ? 'pd.DataFrame' : '_ChartResult';
}
