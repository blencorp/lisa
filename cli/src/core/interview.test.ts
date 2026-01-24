import { describe, it, expect } from 'vitest';
import { runInterview } from './interview.js';

describe('runInterview', () => {
  it('returns a result object', async () => {
    const result = await runInterview({
      feature: 'test feature',
    });

    expect(result).toHaveProperty('success');
    expect(typeof result.success).toBe('boolean');
  });

  it('accepts interview options', async () => {
    const result = await runInterview({
      feature: 'test feature',
      firstPrinciples: true,
      contextFiles: ['file1.md', 'file2.md'],
      provider: 'claude',
    });

    expect(result).toBeDefined();
  });
});
