import { UUID } from '#lib/field-rules.ts';
import { readBody } from '#lib/json.ts';
import { startDraft, startedOnPhone } from '#lib/server/drafts.ts';
import { refuse } from '#lib/server/field-errors.ts';
import { problem } from '#lib/server/problem.ts';
import type { RequestHandler } from './$types';

/**
 * Starts a draft from the phone's queue (#lib/queue): for which client, and the
 * uuid the phone made for it. It takes its number now. Safe to call twice: a
 * repeat answers with the draft the first one started.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await readBody(request);
	if (!body) return problem('malformed', 400, 'Expected a JSON object.');
	const clientUuid = typeof body.client_uuid === 'string' ? body.client_uuid : '';
	if (!UUID.test(clientUuid)) return refuse({ client_uuid: 'The uuid the phone made for it.' });
	const entityId = typeof body.entity_id === 'string' ? body.entity_id : '';
	if (!UUID.test(entityId)) return refuse({ entity_id: 'Which client.' });
	const started = await startDraft({ entityId, clientUuid, userId: locals.user!.id });
	if (!started.ok) return refuse(started.errors);
	return Response.json({ id: started.id, number: started.number }, { status: 200 });
};

/** The draft a phone started, by the uuid it made for it, once it has arrived. */
export const GET: RequestHandler = async ({ url }) => {
	const clientUuid = url.searchParams.get('client_uuid') ?? '';
	if (!UUID.test(clientUuid)) return refuse({ client_uuid: 'The uuid the phone made for it.' });
	const had = await startedOnPhone(clientUuid);
	if (!had) return problem('notFound', 404, 'No draft has arrived with that uuid.');
	return Response.json(had, { headers: { 'cache-control': 'no-store' } });
};
