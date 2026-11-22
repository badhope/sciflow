import { describe, expect, it } from 'vitest';
import { McpService } from './mcp.service';

function bareMcp(): McpService {
  const args = Array.from({ length: 19 }, () => ({}));
  return new (McpService as unknown as new (...a: unknown[]) => McpService)(...args);
}

describe('MCP prompts', () => {
  it('lists reusable research workflow prompts with argument schemas', () => {
    const prompts = bareMcp().listPrompts();
    expect(prompts.map((p) => p.name)).toEqual([
      'sciflow.research.plan',
      'sciflow.literature.review',
      'sciflow.paper.polish',
      'sciflow.review.response',
      'sciflow.submission.readiness',
    ]);
    expect(prompts[0].arguments).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'topic', required: true })]),
    );
  });

  it('fills arguments and rejects unknown names or missing required args', () => {
    const mcp = bareMcp();
    const result = mcp.getPrompt('sciflow.paper.polish', { text: '本文研究图神经网络。', venue: '软件学报' });
    expect(result?.text).toContain('本文研究图神经网络。');
    expect(result?.text).toContain('软件学报');
    expect(mcp.getPrompt('missing.prompt', {})).toBeNull();
    expect(() => mcp.getPrompt('sciflow.research.plan', {})).toThrow(/topic/);
  });
});
