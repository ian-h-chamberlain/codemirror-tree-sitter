// See esbuild config for details
declare module "*.wasm" {
  const filepath: string;
  export default filepath;
}

declare module "*.html" {
  const empty: undefined;
  export default empty;
}
