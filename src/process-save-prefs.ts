/* eslint-disable @typescript-eslint/no-use-before-define */
import { getConnection, groupByFunction, logBeforeTimeout, logger } from '@firestone-hs/aws-lambda-utils';
import { ServerlessMysql } from 'serverless-mysql';
import SqlString from 'sqlstring';
import { Input } from './sqs-event';

export default async (event, context): Promise<any> => {
	const cleanup = logBeforeTimeout(context);
	const events: readonly Input[] = (event.Records as any[])
		.map(event => JSON.parse(event.body))
		.reduce((a, b) => a.concat(b), [])
		.filter(event => event);
	// TODO: do some filtering to keep only the latest for a given userId or userName
	const mysql = await getConnection();
	const latestEvents = extractLatest(events);
	for (const ev of latestEvents) {
		await processEvent(ev, mysql);
	}
	const response = {
		statusCode: 200,
		isBase64Encoded: false,
		body: null,
	};
	await mysql.end();
	cleanup();
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
	logger.debug('handling event', input);
	const userQuery = `
		SELECT userId, userName
		FROM user_mapping
		WHERE userId = ${escape(input.userId)} OR userName = ${input.userName ? escape(input.userName) : escape('__invalid__')}
	`;
	const userMappingDbResults: readonly any[] = await mysql.query(userQuery);
	logger.debug(
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

		const userNameCriteria =
			userNames.length > 0 ? `userName IN (${userNames.map(result => escape(result)).join(',')})` : '';
		const existingQuery = `
			SELECT id 
			FROM user_prefs
			WHERE ${userIdCriteria} ${linkWord} ${userNameCriteria}
		`;
		const existingDbResuls: readonly any[] = await mysql.query(existingQuery);
		logger.debug(
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
	const insertResults: readonly any[] = await mysql.query(insertQuery);
	logger.debug(
		'executed query',
		insertResults && insertResults.length,
		insertResults && insertResults.length > 0 && insertResults[0],
	);
};
