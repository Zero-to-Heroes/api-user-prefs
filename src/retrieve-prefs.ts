import { getConnection, logBeforeTimeout, logger } from '@firestone-hs/aws-lambda-utils';
import SqlString from 'sqlstring';
import { gzipSync } from 'zlib';
import { Input } from './sqs-event';

export default async (event, context): Promise<any> => {
	const cleanup = logBeforeTimeout(context);
	const input: Input = JSON.parse(event.body);
	logger.debug('handling event', input);

	const mysql = await getConnection();

	const escape = SqlString.escape;
	const userQuery = `
		SELECT DISTINCT userId, userName
		FROM user_mapping
		WHERE userId = ${escape(input.userId)} OR userName = ${input.userName ? escape(input.userName) : escape('__invalid__')}
	`;
	const userMappingDbResults: readonly any[] = await mysql.query(userQuery);
	logger.debug(
		'executed query',
		userMappingDbResults && userMappingDbResults.length,
		userMappingDbResults && userMappingDbResults.length > 0 && userMappingDbResults[0],
	);

	const userIds = [
		...new Set(userMappingDbResults.map((result) => result.userId).filter((userId) => userId?.length)),
	];
	// First-time user, no mapping registered yet
	if (!userIds?.length) {
		await mysql.end();
		cleanup();
		return {
			statusCode: 200,
			// isBase64Encoded: true,
			body: null,
			// headers: {
			// 	'Content-Type': 'text/html',
			// 	'Content-Encoding': 'gzip',
			// },
		};
	}

	const userNames = [...new Set(userMappingDbResults.map((result) => result.userName))]
		.filter((userName) => userName != '__invalid')
		.filter((userName) => userName?.length && userName.length > 0);
	const userIdCriteria = `userId IN (${userIds.map((userId) => escape(userId)).join(',')})`;
	const linkWord = userIds.length > 0 && userNames.length > 0 ? 'OR ' : '';

	const userNameCriteria =
		userNames.length > 0 ? `userName IN (${userNames.map((result) => escape(result)).join(',')})` : '';
	const existingQuery = `
		SELECT prefs 
		FROM user_prefs
		WHERE ${userIdCriteria} ${linkWord} ${userNameCriteria}
	`;
	const results: readonly any[] = await mysql.query(existingQuery);
	const result: any = results && results.length > 0 ? results[0] : null;
	await mysql.end();

	const stringResults = result?.prefs;
	const gzippedResults = stringResults ? gzipSync(stringResults).toString('base64') : null;
	const response = {
		statusCode: 200,
		isBase64Encoded: true,
		body: gzippedResults,
		headers: {
			'Content-Type': 'text/html',
			'Content-Encoding': 'gzip',
		},
	};

	cleanup();
	return response;
};
