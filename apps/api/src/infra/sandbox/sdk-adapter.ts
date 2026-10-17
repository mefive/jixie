/**
 * 将执行环境绑定为作者 SDK 所需的原始能力。
 * Bind an execution environment to the primitives required by an author SDK.
 */
export interface SdkAdapter<Input, Capabilities> {
  bind(input: Input): Capabilities;
}
