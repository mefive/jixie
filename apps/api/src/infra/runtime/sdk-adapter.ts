/** Bind an execution environment to the primitives required by an author SDK. */
export interface SdkAdapter<Input, Capabilities> {
  bind(input: Input): Capabilities;
}
