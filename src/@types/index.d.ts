// See esbuild config for details
declare module "*.wasm" {
  const filepath: string;
  export default filepath;
}

declare module "*.html" {
  function load(): void;
  export default load;
}
