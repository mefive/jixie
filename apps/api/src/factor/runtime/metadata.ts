import { UserCodeError } from '#infra/errors.js';
import { FACTOR_V2_FIELDS, isFactorV2FieldKey } from '../definitions/fields.js';
import type { AssetFactorKind, AssetFactorRuntimeMetadata } from './contract.js';

export function validateTypeScriptFactorMetadata(metadata: AssetFactorRuntimeMetadata): void {
  if (!metadata.name?.trim()) {
    throw new UserCodeError('Factor V2 requires a name.');
  }
  if (
    !Array.isArray(metadata.inputs) ||
    metadata.inputs.some((input) => !isFactorV2FieldKey(input))
  ) {
    throw new UserCodeError('Factor V2 references an unknown input field.');
  }
  if (new Set(metadata.inputs).size !== metadata.inputs.length) {
    throw new UserCodeError('Factor V2 input fields must be unique.');
  }
  const allowedAssetClasses = new Set(['equity', 'fixed_income', 'commodity']);
  if (
    !Array.isArray(metadata.targetAssetClasses) ||
    metadata.targetAssetClasses.length === 0 ||
    metadata.targetAssetClasses.some((assetClass) => !allowedAssetClasses.has(assetClass))
  ) {
    throw new UserCodeError('Factor V2 target asset classes are invalid.');
  }
  if (
    metadata.inputs.some((input) =>
      metadata.targetAssetClasses.some(
        (assetClass) => !FACTOR_V2_FIELDS[input].targetAssetClasses.includes(assetClass),
      ),
    )
  ) {
    throw new UserCodeError(
      'Factor V2 target asset classes are incompatible with its declared inputs.',
    );
  }
}

export function validatePythonFactorMetadata(
  metadata: AssetFactorRuntimeMetadata,
  analysisKind: AssetFactorKind,
): void {
  if (metadata.analysisKind !== analysisKind || !metadata.name?.trim()) {
    throw new Error(`Python ${analysisKind} Factor metadata is invalid.`);
  }
  if (
    !Array.isArray(metadata.inputs) ||
    metadata.inputs.length === 0 ||
    metadata.inputs.some((input) => !isFactorV2FieldKey(input)) ||
    new Set(metadata.inputs).size !== metadata.inputs.length
  ) {
    throw new Error('Python Factor references invalid or duplicate input fields.');
  }
  const targetAssetClasses = metadata.targetAssetClasses;
  const allowed = new Set(['equity', 'fixed_income', 'commodity']);
  if (
    !Array.isArray(targetAssetClasses) ||
    targetAssetClasses.length === 0 ||
    targetAssetClasses.some((assetClass) => !allowed.has(assetClass))
  ) {
    throw new Error('Python Factor target asset classes are invalid.');
  }
  for (const input of metadata.inputs) {
    if (
      targetAssetClasses.some(
        (assetClass) => !FACTOR_V2_FIELDS[input].targetAssetClasses.includes(assetClass),
      )
    ) {
      throw new Error('Python Factor target asset classes are incompatible with its inputs.');
    }
  }
}
