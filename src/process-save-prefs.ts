/* eslint-disable @typescript-eslint/no-use-before-define */
import { ServerlessMysql } from 'serverless-mysql';
import SqlString from 'sqlstring';
import { getConnection } from './db/rds';
import { groupByFunction } from './db/utils';
import { Input } from './sqs-event';

export default async (event, context): Promise<any> => {
	console.log('received event', event);
	const events: readonly Input[] = (event.Records as any[])
		.map(event => JSON.parse(event.body))
		.reduce((a, b) => a.concat(b), [])
		.filter(event => event);
	// TODO: do some filtering to keep only the latest for a given userId or userName
	const mysql = await getConnection();
	const latestEvents = extractLatest(events);
	for (const ev of latestEvents) {
		console.log('processing event', ev);
		await processEvent(ev, mysql);
	}
	const response = {
		statusCode: 200,
		isBase64Encoded: false,
		body: null,
	};
	console.log('sending back success reponse');
	await mysql.end();
	return response;
};

const extractLatest = (events: readonly Input[]): readonly Input[] => {
	const groupedByUserId = groupByFunction((event: Input) => event.userId)(events);
	return Object.values(groupedByUserId)
		.map((results: readonly Input[]) =>
			[...results].sort(
				(a: Input, b: Input) => (b.lastUpdateDate?.getTime() ?? 0) - (a.lastUpdateDate?.getTime() ?? 0),
			),
		)
		.map(results => results[0]);
};

const processEvent = async (input: Input, mysql: ServerlessMysql) => {
	const escape = SqlString.escape;
	console.debug('handling event', input);
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
	let existingUserId: string = null;
	if (userIds.length > 0) {
		const userNames = [...new Set(userMappingDbResults.map(result => result.userName))]
			.filter(userName => userName != '__invalid')
			.filter(userName => userName?.length && userName.length > 0);
		const userIdCriteria = `userId IN (${userIds.map(userId => escape(userId)).join(',')})`;
		const linkWord = userIds.length > 0 && userNames.length > 0 ? 'OR ' : '';
		console.log('linkWork', linkWord, userIds, userNames);

		const userNameCriteria =
			userNames.length > 0 ? `userName IN (${userNames.map(result => escape(result)).join(',')})` : '';
		const existingQuery = `
			SELECT id 
			FROM user_prefs
			WHERE ${userIdCriteria} ${linkWord} ${userNameCriteria}
		`;
		console.log('prepared query', existingQuery, userNames);
		const existingDbResuls: readonly any[] = await mysql.query(existingQuery);
		console.log(
			'executed query',
			existingDbResuls && existingDbResuls.length,
			existingDbResuls && existingDbResuls.length > 0 && existingDbResuls[0],
		);
		existingUserId = existingDbResuls?.length > 0 ? existingDbResuls[0].id : null;
	}

	const insertQuery =
		existingUserId != null
			? `
				UPDATE user_prefs
				SET 
					userId = ${escape(input.userId)},
					userName = ${escape(input.userName)},
					lastUpdateDate = ${escape(new Date())},
					prefs = ${escape(JSON.stringify(input.prefs))}
				WHERE id = ${existingUserId};
			`
			: `
				INSERT INTO user_prefs
				(userId, userName, lastUpdateDate, prefs)
				VALUES (
					${escape(input.userId)},
					${escape(input.userName)},
					${escape(new Date())},
					${escape(JSON.stringify(input.prefs))}
				);
			`;
	console.log('prepared query', insertQuery);
	const insertResults: readonly any[] = await mysql.query(insertQuery);
	console.log(
		'executed query',
		insertResults && insertResults.length,
		insertResults && insertResults.length > 0 && insertResults[0],
	);
};
