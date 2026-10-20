import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const runDir = process.env.CINDY_ACCEPTANCE_RUN_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-agents-md-desktop-'));
if (!path.resolve(runDir).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Fixture must stay in OS temp');
const requests = path.join(runDir, 'request-metadata.jsonl');
const reply = 'LOCAL_ACCEPTANCE_OK';
const server = http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  let input = {}; try { input = JSON.parse(raw || '{}'); } catch {}
  // Never retain request messages, system prompts or header values.
  fs.appendFileSync(requests, JSON.stringify({ at: new Date().toISOString(), method: req.method, path: req.url, model: input.model, stream: input.stream === true, hasAuth: Boolean(req.headers.authorization || req.headers['x-api-key']), sawNativeInstructionMarker: raw.includes('# native acceptance fixture') }) + '\n');
  const json = (value) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  if (req.url.includes('count_tokens')) return json({ input_tokens: 1 });
  if (req.method === 'GET') return json({ object: 'list', data: [{ id: 'claude-sonnet-4-5', type: 'model', display_name: 'Local Acceptance Claude' }, { id: 'gpt-5.4', object: 'model', owned_by: 'local-acceptance' }] });
  if (req.url.includes('messages')) {
    const message = { id: 'msg_local_acceptance', type: 'message', role: 'assistant', model: input.model, content: [{ type: 'text', text: reply }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    if (!input.stream) return json(message);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    event('message_start', { message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } });
    event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: reply } });
    event('content_block_stop', { index: 0 });
    event('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } });
    event('message_stop', {}); return res.end();
  }
  if (req.url.includes('responses')) {
    const item = { id: 'msg_local_acceptance', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: reply, annotations: [] }] };
    const response = { id: 'resp_local_acceptance', object: 'response', created_at: Math.floor(Date.now()/1000), status: 'completed', model: input.model, output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    if (!input.stream) return json(response);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    let sequence_number = 0;
    const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence_number++, ...data })}\n\n`);
    event('response.created', { response: { ...response, status: 'in_progress', output: [] } });
    event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
    event('response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
    event('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: reply });
    event('response.output_text.done', { item_id: item.id, output_index: 0, content_index: 0, text: reply });
    event('response.content_part.done', { item_id: item.id, output_index: 0, content_index: 0, part: item.content[0] });
    event('response.output_item.done', { output_index: 0, item });
    event('response.completed', { response }); return res.end();
  }
  return json({ ok: true });
});
server.listen(Number(process.env.CINDY_ACCEPTANCE_PORT || 0), '127.0.0.1', () => {
  const state = { runDir, baseUrl: `http://127.0.0.1:${server.address().port}`, pid: process.pid };
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(state, null, 2));
  console.log(JSON.stringify(state));
});
