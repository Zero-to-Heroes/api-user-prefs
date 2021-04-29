import SqlString from 'sqlstring';
import { gzipSync } from 'zlib';
import { getConnection } from './db/rds';
import { Input } from './sqs-event';

export default async (event): Promise<any> => {
	const input: Input = JSON.parse(event.body);
	console.debug('handling event', input);

	const mysql = await getConnection();

	const escape = SqlString.escape;
	const userQuery = `
		SELECT userId, userName
		FROM user_mapping
		WHERE userId = ${escape(input.userId)} OR userName = ${input.userName ? escape(input.userName) : escape('__invalid__')}
	`;
	console.log('prepared query', userQuery);
	const userMappingDbResults: readonly any[] = await mysql.query(userQuery);
	console.log(
		'executed query',
		userMappingDbResults && userMappingDbResults.length,
		userMappingDbResults && userMappingDbResults.length > 0 && userMappingDbResults[0],
	);

	const userIds = [...new Set(userMappingDbResults.map(result => result.userId).filter(userId => userId?.length))];
	// First-time user, no mapping registered yet
	if (!userIds?.length) {
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

	const userNames = [...new Set(userMappingDbResults.map(result => result.userName))]
		.filter(userName => userName != '__invalid')
		.filter(userName => userName?.length && userName.length > 0);
	const userIdCriteria = `userId IN (${userIds.map(userId => escape(userId)).join(',')})`;
	const linkWord = userIds.length > 0 && userNames.length > 0 ? 'OR ' : '';
	console.log('linkWork', linkWord, userIds, userNames);

	const userNameCriteria =
		userNames.length > 0 ? `userName IN (${userNames.map(result => escape(result)).join(',')})` : '';
	const existingQuery = `
		SELECT prefs 
		FROM user_prefs
		WHERE ${userIdCriteria} ${linkWord} ${userNameCriteria}
	`;
	console.log('prepared query', existingQuery);
	const results: readonly any[] = await mysql.query(existingQuery);
	console.log('executed query', results && results.length, results && results.length > 0 && results[0]);
	const result: any = results && results.length > 0 ? results[0] : null;
	await mysql.end();

	const stringResults = result?.prefs;
	const gzippedResults = stringResults ? gzipSync(stringResults).toString('base64') : null;
	console.log('compressed', stringResults?.length, gzippedResults?.length);
	const response = {
		statusCode: 200,
		isBase64Encoded: true,
		body: gzippedResults,
		headers: {
			'Content-Type': 'text/html',
			'Content-Encoding': 'gzip',
		},
	};

	return response;
};
