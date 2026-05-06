import { describe, it, expect } from 'vitest';
import { withThinkingPlaceholder, markActivityDone, removeThinkingPlaceholder, stripStreaming } from '../hooks/useStreaming';

describe('streaming message helpers', () => {
  it('stripStreaming removes _streaming messages', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: '_streaming', content: 'partial' },
      { role: 'assistant', content: 'hello' },
    ];
    expect(stripStreaming(messages)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('removeThinkingPlaceholder filters placeholder activity', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'activity', content: 'Thinking...', placeholder: true },
      { role: 'assistant', content: 'done' },
    ];
    expect(removeThinkingPlaceholder(messages)).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'done' },
    ]);
  });

  it('withThinkingPlaceholder appends a placeholder after cleaning', () => {
    const messages = [
      { role: 'user', content: 'hi' },
    ];
    const result = withThinkingPlaceholder(messages);
    expect(result).toHaveLength(2);
    expect(result[1].role).toBe('activity');
    expect(result[1].placeholder).toBe(true);
    expect(result[1].content).toBe('Thinking...');
  });

  it('withThinkingPlaceholder replaces an existing placeholder', () => {
    const messages = [
      { role: 'user', content: 'hi' },
      { role: 'activity', content: 'Thinking...', placeholder: true, state: 'running' },
    ];
    const result = withThinkingPlaceholder(messages);
    const placeholders = result.filter((m) => m.placeholder);
    expect(placeholders).toHaveLength(1);
  });

  it('markActivityDone sets running activities to done', () => {
    const messages = [
      { role: 'activity', content: 'Working', state: 'running' },
      { role: 'activity', content: 'Finished', state: 'done' },
      { role: 'user', content: 'hi' },
    ];
    const result = markActivityDone(messages);
    expect(result[0].state).toBe('done');
    expect(result[1].state).toBe('done');
    expect(result[2]).toEqual({ role: 'user', content: 'hi' });
  });
});
