import { it, expect } from 'vitest';
import { registry } from './registry';
it('registered node fields have typed defaults and unique ports', () => {
  expect(new Set(registry.map(d => d.type)).size).toBe(registry.length);
  for (const def of registry) {
    expect(def.description).toBeTruthy();
    for (const direction of [def.inputs, def.outputs]) {
      expect(new Set(direction).size).toBe(direction.length);
    }
    for (const field of def.fields) {
      expect(typeof field.default).toBe(field.kind === 'number' ? 'number' : 'string');
      if (field.options) expect(field.options).toContain(field.default);
    }
  }
});
