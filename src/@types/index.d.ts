// See rollup config for implementation
declare module "*.wasm" {
  function load(): {
    sync: boolean;
    filepath: string;
    src?: unknown;
    imports?: unknown;
  };
  export default load;
}
