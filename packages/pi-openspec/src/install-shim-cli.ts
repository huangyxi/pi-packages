import { installShim } from './install-shim';

try {
	const result = await installShim();
	console.log(`@hyxi/pi-openspec: openspec wrap script ${result.status} at ${result.path}`);
} catch (error) {
	console.warn(
		`@hyxi/pi-openspec: could not install the openspec wrap script: ${error instanceof Error ? error.message : String(error)}`,
	);
}
