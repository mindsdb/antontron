import { describe, it, expect } from 'vitest';
import { initialStreamState, reduceStream, reduceAll, parseSSEChunk } from '../lib/responseStreamAdapter';

const FIXED_NOW = () => 1700000000000;

describe('responseStreamAdapter', () => {
  describe('initialStreamState', () => {
    it('returns a fresh pending state', () => {
      const state = initialStreamState();
      expect(state.status).toBe('pending');
      expect(state.steps).toEqual([]);
      expect(state.bodyText).toBe('');
      expect(state.error).toBeNull();
      expect(state.responseId).toBeNull();
      expect(state.conversationId).toBeNull();
    });
  });

  describe('reduceStream', () => {
    it('ignores null/undefined events', () => {
      const state = initialStreamState();
      expect(reduceStream(state, null)).toBe(state);
      expect(reduceStream(state, undefined)).toBe(state);
    });

    it('handles response.created', () => {
      const state = reduceStream(initialStreamState(), {
        type: 'response.created',
        response: { id: 'resp-1' },
        conversation_id: 'conv-1',
      }, FIXED_NOW);
      expect(state.responseId).toBe('resp-1');
      expect(state.conversationId).toBe('conv-1');
      expect(state.status).toBe('thinking');
      expect(state.startedAt).toBe(1700000000000);
    });

    it('handles response.output_text.delta', () => {
      let state = initialStreamState();
      state = reduceStream(state, { type: 'response.output_text.delta', delta: 'Hello' }, FIXED_NOW);
      state = reduceStream(state, { type: 'response.output_text.delta', delta: ' world' }, FIXED_NOW);
      expect(state.bodyText).toBe('Hello world');
      expect(state.status).toBe('streaming');
    });

    it('ignores empty delta', () => {
      const state = reduceStream(initialStreamState(), { type: 'response.output_text.delta', delta: '' }, FIXED_NOW);
      expect(state.bodyText).toBe('');
    });

    it('handles response.completed', () => {
      const state = reduceStream(initialStreamState(), { type: 'response.completed' }, FIXED_NOW);
      expect(state.status).toBe('done');
    });

    it('handles response.failed', () => {
      const state = reduceStream(initialStreamState(), {
        type: 'response.failed',
        error: 'something broke',
      }, FIXED_NOW);
      expect(state.status).toBe('error');
      expect(state.error).toBe('something broke');
    });

    it('handles scratchpad lifecycle (start → end → result)', () => {
      let state = initialStreamState();

      // Start
      state = reduceStream(state, {
        type: 'response.in_progress',
        thought_role: 'thought.scratchpad.start',
      }, FIXED_NOW);
      expect(state.steps).toHaveLength(1);
      expect(state.steps[0].status).toBe('in_progress');
      expect(state.steps[0]._isScratchpad).toBe(true);

      // End (input with code/description)
      state = reduceStream(state, {
        type: 'response.in_progress',
        thought_role: 'thought.scratchpad.end',
        content: JSON.stringify({
          one_line_description: 'Fetch user data',
          name: 'analysis',
          code: 'print("hello")',
        }),
      }, FIXED_NOW);
      expect(state.steps[0].label).toBe('Fetch user data');
      expect(state.steps[0].data.code).toBe('print("hello")');

      // Result (output)
      state = reduceStream(state, {
        type: 'response.in_progress',
        thought_role: 'thought.scratchpad.result',
        content: JSON.stringify({ stdout: 'hello\n', stderr: '' }),
      }, FIXED_NOW);
      expect(state.steps[0].status).toBe('completed');
      expect(state.steps[0].output).toBe('hello\n');
    });

    it('handles publish_or_preview artifact sequence', () => {
      let state = initialStreamState();

      state = reduceStream(state, {
        type: 'response.in_progress',
        thought_role: 'thought.progress',
        content: 'publish_or_preview',
      }, FIXED_NOW);
      expect(state.awaitingArtifactPayload).toBe(true);

      state = reduceStream(state, {
        type: 'response.in_progress',
        thought_role: 'thought.progress',
        content: JSON.stringify({ title: 'Report.html', file_path: '/output/report.html' }),
      }, FIXED_NOW);
      expect(state.awaitingArtifactPayload).toBe(false);
      expect(state.steps).toHaveLength(1);
      expect(state.steps[0].badge).toBe('Artifact');
      expect(state.steps[0].label).toBe('Report.html');
    });

    it('handles scratchpad_done progress phase', () => {
      let state = initialStreamState();
      state = reduceStream(state, {
        type: 'response.in_progress',
        thought_role: 'thought.scratchpad.start',
      }, FIXED_NOW);
      state = reduceStream(state, {
        type: 'response.in_progress',
        thought_role: 'thought.progress',
        phase: 'scratchpad_done',
      }, FIXED_NOW);
      expect(state.steps[0].executionCompletedAt).toBe(1700000000000);
    });
  });

  describe('reduceAll', () => {
    it('folds a full conversation lifecycle', () => {
      const events = [
        { type: 'response.created', response: { id: 'r1' }, conversation_id: 'c1' },
        { type: 'response.output_text.delta', delta: 'Hi ' },
        { type: 'response.output_text.delta', delta: 'there' },
        { type: 'response.completed' },
      ];
      const state = reduceAll(events, initialStreamState(), FIXED_NOW);
      expect(state.status).toBe('done');
      expect(state.bodyText).toBe('Hi there');
      expect(state.conversationId).toBe('c1');
    });
  });

  describe('parseSSEChunk', () => {
    it('parses a single event', () => {
      const buffer = 'event: message\ndata: {"type":"response.created"}\n\n';
      const { events, remainder } = parseSSEChunk(buffer);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('response.created');
      expect(remainder).toBe('');
    });

    it('handles partial frames', () => {
      const buffer = 'event: message\ndata: {"type":"response.created"}\n\ndata: {"type":"re';
      const { events, remainder } = parseSSEChunk(buffer);
      expect(events).toHaveLength(1);
      expect(remainder).toBe('data: {"type":"re');
    });

    it('returns empty for incomplete frame', () => {
      const { events, remainder } = parseSSEChunk('data: partial');
      expect(events).toHaveLength(0);
      expect(remainder).toBe('data: partial');
    });

    it('skips malformed JSON', () => {
      const buffer = 'data: not-json\n\ndata: {"type":"ok"}\n\n';
      const { events } = parseSSEChunk(buffer);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('ok');
    });
  });
});
