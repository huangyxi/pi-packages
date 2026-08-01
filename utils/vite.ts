import banner from 'vite-plugin-banner';

interface PackageMetadata {
	name: string;
	version: string;
	license: string;
	homepage: string;
}

function docComments(comments: string[]): string {
	return `/*!\n${comments.map((comment) => ` * ${comment}`).join('\n')}\n */`;
}

export function packageBanner(packageMetadata: PackageMetadata) {
	const comments = [
		`${packageMetadata.license} License. ${packageMetadata.homepage}`,
		`${packageMetadata.name} ${packageMetadata.version}`,
		`Build date: ${new Date().toISOString()}`,
	];
	const { GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_SERVER_URL } = process.env;
	if (GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID) {
		comments.push(
			`GitHub Actions Build URI: ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`,
		);
	}
	return banner(docComments(comments));
}
