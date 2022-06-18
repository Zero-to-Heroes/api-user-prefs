import { logBeforeTimeout, Sqs } from '@firestone-hs/aws-lambda-utils';
import { Input } from './sqs-event';

const sqs = new Sqs();

export default async (event, context): Promise<any> => {
	const cleanup = logBeforeTimeout(context);
	const headers = {
		'Access-Control-Allow-Headers':
			'Accept,Accept-Language,Content-Language,Content-Type,Authorization,x-correlation-id,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
		'Access-Control-Expose-Headers': 'x-my-header-out',
		'Access-Control-Allow-Methods': 'DELETE,GET,HEAD,OPTIONS,PATCH,POST,PUT',
		'Access-Control-Allow-Origin': event.headers?.Origin || event.headers?.origin || '*',
	};
	// Preflight
	if (!event.body) {
		const response = {
			statusCode: 200,
			body: null,
			headers: headers,
		};
		return response;
	}

	const input: Input = JSON.parse(event.body);
	await sqs.sendMessageToQueue(input, process.env.SQS_URL);
	cleanup();
	return {
		statusCode: 200,
		headers: headers,
		body: '',
	};
};
