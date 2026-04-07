import Runtime from './runtime.js';
import {
	loadRuntimeManifest,
	resolveRuntimeManifestUrl
} from './runtime-manifest.js';
import type {
	BrowserClangArtifact,
	BrowserClangCompileProgress,
	BrowserClangCompileRequest,
	BrowserClangCompiler,
	BrowserClangCompilerResult,
	BrowserClangRuntimeOptions,
	CompilerLogLevel,
	CompilerLogRecord,
	RuntimeManifestV1
} from './types.js';

export type {
	BrowserClangArtifact,
	BrowserClangCompileProgress,
	BrowserClangCompileRequest,
	BrowserClangCompiler,
	BrowserClangCompilerResult,
	CompilerLogLevel,
	CompilerLogRecord
} from './types.js';

export interface CreateClangCompilerOptions {
	runtimeBaseUrl?: string | URL;
	showTiming?: boolean;
	log?: boolean;
	manifest?: RuntimeManifestV1;
	fetchImpl?: typeof fetch;
}

export interface PreloadBrowserClangRuntimeOptions {
	runtimeBaseUrl?: string | URL;
	manifest?: RuntimeManifestV1;
	fetchImpl?: typeof fetch;
}

function toStandaloneBytes(value: Uint8Array | ArrayBuffer) {
	return value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value);
}

function pushRecord(
	records: CompilerLogRecord[],
	enabled: boolean,
	message: string,
	level: CompilerLogLevel = 'log'
) {
	if (!enabled) return;
	records.push({ level, message });
}

function emitProgress(
	request: BrowserClangCompileRequest,
	stage: BrowserClangCompileProgress['stage'],
	percent: number,
	message: string
) {
	request.onProgress?.({
		stage,
		completed: Math.round(percent),
		total: 100,
		percent,
		message
	});
}

async function resolveManifest(options: CreateClangCompilerOptions | PreloadBrowserClangRuntimeOptions) {
	if (options.manifest) {
		return options.manifest;
	}
	return loadRuntimeManifest(
		options.runtimeBaseUrl ? resolveRuntimeManifestUrl(options.runtimeBaseUrl) : undefined,
		options.fetchImpl || fetch
	);
}

export async function preloadBrowserClangRuntime(
	options: PreloadBrowserClangRuntimeOptions = {}
): Promise<void> {
	const manifest = await resolveManifest(options);
	const runtime = new Runtime({
		stdin: () => '',
		stdout: () => {},
		progress: () => {},
		log: false,
		runtimeBaseUrl: options.runtimeBaseUrl,
		manifest
	});
	await runtime.ready;
}

export async function compileClang(
	request: BrowserClangCompileRequest,
	options: CreateClangCompilerOptions = {}
): Promise<BrowserClangCompilerResult> {
	if (!request.code || typeof request.code !== 'string') {
		return {
			success: false,
			stderr: 'wasm-clang requires a non-empty source string'
		};
	}
	if (request.target && request.target !== 'wasm32-wasi') {
		return {
			success: false,
			stderr: `unsupported wasm-clang target: ${request.target}`
		};
	}

	const enabledLogs = request.log ?? options.log ?? false;
	const logRecords: CompilerLogRecord[] = [];
	const compilerOutput: string[] = [];
	emitProgress(request, 'bootstrap', 0, 'loading runtime manifest');
	const manifest = await resolveManifest(options);
	pushRecord(logRecords, enabledLogs, '[wasm-clang] runtime manifest loaded');

	let lastPercent = 0;
	const runtimeOptions: BrowserClangRuntimeOptions = {
		stdin: () => '',
		stdout: (chunk) => compilerOutput.push(chunk),
		progress: (value) => {
			const percent = Math.round(Math.max(lastPercent, value * 100));
			lastPercent = percent;
			const stage = percent < 34 ? 'bootstrap' : percent < 90 ? 'compile' : 'link';
			emitProgress(
				request,
				stage,
				percent,
				stage === 'link'
					? 'linking wasm module'
					: stage === 'compile'
						? 'compiling source'
						: 'loading runtime'
			);
		},
		log: enabledLogs,
		showTiming: request.showTiming ?? options.showTiming ?? false,
		runtimeBaseUrl: options.runtimeBaseUrl,
		manifest
	};

	const runtime = new Runtime(runtimeOptions);

	try {
		await runtime.ready;
		pushRecord(logRecords, enabledLogs, '[wasm-clang] runtime ready');
		await runtime.compileLink(request.code, {
			language: request.language || 'CPP',
			compileArgs: request.compileArgs || [],
			cppVersion: request.cppVersion,
			cVersion: request.cVersion
		});
		const artifactBytes = toStandaloneBytes(runtime.memfs.getFileContents('test.wasm'));
		const artifact: BrowserClangArtifact = {
			bytes: artifactBytes,
			wasm: artifactBytes,
			target: 'wasm32-wasi',
			format: 'wasi-core-wasm'
		};
		emitProgress(request, 'done', 100, 'done');
		return {
			success: true,
			artifact,
			stdout: compilerOutput.join(''),
			...(enabledLogs
				? {
					logRecords,
					logs: logRecords.map((record) => record.message)
				}
				: {})
		};
	} catch (error) {
		pushRecord(
			logRecords,
			enabledLogs,
			error instanceof Error ? error.message : String(error),
			'error'
		);
		return {
			success: false,
			stdout: compilerOutput.join(''),
			stderr: error instanceof Error ? error.message : String(error),
			...(enabledLogs
				? {
					logRecords,
					logs: logRecords.map((record) => record.message)
				}
				: {})
		};
	}
}

export async function createClangCompiler(
	options: CreateClangCompilerOptions = {}
): Promise<BrowserClangCompiler> {
	return {
		compile: (request) => compileClang(request, options)
	};
}
