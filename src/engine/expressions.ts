export interface ExpressionContext {
  input: Record<string, unknown> | null;
  nodes: { name: string; output: Record<string, unknown> | null; status: string }[];
}

function lookup(expression: string, context: ExpressionContext): unknown {
  const match = expression.trim().match(/^(\$json|\$node\["((?:[^"\\]|\\.)*)"\]\.json)((?:\.[A-Za-z_$][\w$]*|\[\]|\["(?:[^"\\]|\\.)*"\])*)$/);
  if (!match) throw new Error(`Invalid data expression: ${expression}`);
  let value: unknown = context.input ?? {};
  if (match[2] !== undefined) {
    const name = JSON.parse(`"${match[2]}"`);
    const nodes = context.nodes.filter(node => node.name === name);
    if (nodes.length !== 1) throw new Error(`${nodes.length ? 'Ambiguous' : 'Missing'} node reference: ${name}`);
    if (nodes[0].status !== 'success') throw new Error(`Node has no prior successful output: ${name}`);
    value = nodes[0].output;
  }
  const segments = match[3].match(/\.[A-Za-z_$][\w$]*|\[\]|\["(?:[^"\\]|\\.)*"\]/g) || [];
  for (const segment of segments) {
    const key = segment[0] === '.' ? segment.slice(1) : String(JSON.parse(segment.slice(1, -1)));
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(`Forbidden property: ${key}`);
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) throw new Error(`Missing own property: ${key}`);
    value = (value as Record<string, unknown>)[key];
  }
  return structuredClone(value);
}

export function resolveExpressions(value: unknown, context: ExpressionContext): unknown {
  if (typeof value !== 'string' || !value.includes('{{')) return value;
  const matches = [...value.matchAll(/\{\{([\s\S]*?)\}\}/g)];
  if (!matches.length || value.replace(/\{\{[\s\S]*?\}\}/g, '').includes('{{')) throw new Error('Unclosed data expression');
  if (matches.length === 1 && matches[0][0] === value) return lookup(matches[0][1], context);
  return value.replace(/\{\{([\s\S]*?)\}\}/g, (_, expression: string) => {
    const result = lookup(expression, context);
    return typeof result === 'string' ? result : JSON.stringify(result);
  });
}
