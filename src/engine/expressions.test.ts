import { describe, expect, it } from 'vitest';
import { resolveExpressions } from './expressions';

describe('bounded data lookup invariants', () => {
  const context = { input: { count: 7, user: { name: 'Ada' } }, nodes: [] };
  it('returns native types for whole-field expressions and text for interpolation', () => {
    expect(resolveExpressions('{{$json.count}}', context)).toBe(7);
    expect(resolveExpressions('{{$json.user}}', context)).toEqual({ name: 'Ada' });
    expect(resolveExpressions('user: {{$json.user.name}}', context)).toBe('user: Ada');
    expect(resolveExpressions('plain', context)).toBe('plain');
  });
  it('rejects unsafe, prototype and invalid lookups without executing anything', () => {
    for (const expression of ['{{constructor}}', '{{count.constructor}}', '{{count.__proto__}}', '{{count["constructor"]}}', '{{js:1+1}}', '{{', 'a {{count}} b {{missing}}']) {
      expect(() => resolveExpressions(expression, context), expression).toThrow();
    }
    expect(context.input).toEqual({ count: 7, user: { name: 'Ada' } });
  });
  it('gives clear errors for missing and ambiguous node references', () => {
    const withNodes = { input: {}, nodes: [{ name: 'Fetch', output: {}, status: 'success' }, { name: 'Fetch', output: {}, status: 'success' }] };
    expect(() => resolveExpressions('{{$node["Ghost"].json.x}}', context)).toThrow('Missing node reference: Ghost');
    expect(() => resolveExpressions('{{$node["Fetch"].json.x}}', withNodes)).toThrow('Ambiguous node reference: Fetch');
    const failed = { input: {}, nodes: [{ name: 'Fetch', output: null, status: 'error' }] };
    expect(() => resolveExpressions('{{$node["Fetch"].json.x}}', failed)).toThrow('no prior successful output');
    expect(() => resolveExpressions('{{$json.count.missing.deep}}', context)).toThrow('Missing own property: missing');
  });
});
