const { createClangCompiler, executeBrowserClangArtifact } = await import(
	new URL('../dist/index.js', import.meta.url)
);

const compiler = await createClangCompiler();
const result = await compiler.compile({
	language: 'C',
	code: '#include <stdio.h>\nint main() { puts("probe-ok"); }\n'
});

if (!result.success || !result.artifact) {
	throw new Error(result.stderr || 'wasm-clang smoke compile failed');
}

const execution = await executeBrowserClangArtifact(result.artifact);
if (!execution.stdout.includes('probe-ok')) {
	throw new Error(`wasm-clang smoke execution failed: ${execution.stdout}`);
}

console.log('wasm-clang smoke runtime verified');
