# wasm-clang

`wasm-clang` packages the existing browser clang runtime that currently lives inside `wasm-idle`
into a standalone TypeScript module with bundled runtime assets.

Current scope:

- reusable browser runtime class for compile/link/run
- packaged `clang.zip`, `lld.zip`, `memfs.zip`, `sysroot.tar.zip`, and `clangd` browser assets
- runtime manifest and build metadata under `dist/runtime/`
- high-level `createClangCompiler()`, `executeBrowserClangArtifact()`, and `resolveRuntimeAssetUrls()` helpers
- unit tests ported from the current `wasm-idle` clang host

## Build

```bash
cd wasm-clang
npm install
npm run build
```

## Runtime assets

The initial runtime source is seeded from the current `wasm-idle/static/clang/bin/` and
`wasm-idle/static/clangd/` bundles so the standalone package can be integrated first. The build
copies those vendored assets into `dist/runtime/bin/` and `dist/runtime/clangd/`, then writes:

- `dist/runtime/runtime-manifest.v1.json`
- `dist/runtime/runtime-build.json`

## Consumer contract

```ts
import createClangCompiler, {
  executeBrowserClangArtifact,
  preloadBrowserClangRuntime
} from './dist/index.js';

await preloadBrowserClangRuntime();

const compiler = await createClangCompiler();
const result = await compiler.compile({
  language: 'CPP',
  code: '#include <iostream>\nint main(){ std::cout << "hi\\n"; }'
});

if (result.success && result.artifact) {
  const runtime = await executeBrowserClangArtifact(result.artifact);
  console.log(runtime.stdout);
}
```

The next step is to switch `wasm-idle` to import this package instead of keeping its own private
clang source/runtime copy.
