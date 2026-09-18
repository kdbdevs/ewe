import { useMemo, useState } from 'react';
import type { NodeMetadata, ParameterField } from '../nodes/registry';
import type { WorkflowNode } from '../model';

interface ValidationRule { message: (value: string) => string | null; }
const rules = (field: ParameterField): ValidationRule => ({
  message: value => {
    if (value === '') return field.optional ? null : `${field.label} is required`;
    if (field.kind === 'number') {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return `${field.label} must be a number`;
      if ((field.min !== undefined && parsed < field.min) || (field.max !== undefined && parsed > field.max)) return `${field.label} must be between ${field.min} and ${field.max}`;
    } else if (field.options && !field.options.includes(value)) return `${field.label} must be one of: ${field.options.join(', ')}`;
    return null;
  },
});

export default function ConfigPanel({ node, def, onParameterChange, onNameChange, onDelete }: {
  node: WorkflowNode;
  def: NodeMetadata;
  onParameterChange: (key: string, value: string | number) => void;
  onNameChange: (name: string) => void;
  onDelete: () => void;
}) {
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const problems = useMemo(() => Object.fromEntries(def.fields.map(field => [field.key, rules(field).message(String(node.parameters[field.key] ?? ''))])), [node.parameters, def.fields]);
  return (
    <aside className="ewe-config" data-testid="config-panel">
      <header>
        <span className="ewe-config-icon">{def.icon}</span>
        <div>
          <h2>{def.name}</h2>
          <p>{def.description}</p>
        </div>
      </header>
      <label className="ewe-field">
        <span>Node name</span>
        <input data-testid="node-name" value={node.name} onChange={event => onNameChange(event.target.value)} />
      </label>
      <p className="ewe-expression-hint">Values accept {'{{ $json.field }}'} and {'{{ $node["Node name"].json.field }}'} lookups, resolved when the workflow runs.</p>
      {def.fields.map(field => (
        <label key={field.key} className="ewe-field">
          <span>{field.label}{field.optional ? ' · optional' : ''}</span>
          {field.kind === 'select' ? (
            <select data-testid={`param-${field.key}`} value={String(node.parameters[field.key] ?? '')} onChange={event => onParameterChange(field.key, event.target.value)}>
              {field.options!.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          ) : field.kind === 'multiline' ? (
            <textarea data-testid={`param-${field.key}`} rows={3} value={String(node.parameters[field.key] ?? '')} onChange={event => onParameterChange(field.key, event.target.value)} />
          ) : (
            <input
              data-testid={`param-${field.key}`}
              type={field.kind === 'number' ? 'number' : 'text'}
              value={String(node.parameters[field.key] ?? '')}
              min={field.min} max={field.max}
              onBlur={() => setTouched(current => ({ ...current, [field.key]: true }))}
              onChange={event => { setTouched(current => ({ ...current, [field.key]: true })); onParameterChange(field.key, field.kind === 'number' ? Number(event.target.value) : event.target.value); }}
            />
          )}
          {touched[field.key] && problems[field.key] && <span className="ewe-field-error" data-testid={`field-error-${field.key}`}>{problems[field.key]}</span>}
        </label>
      ))}
      <footer>
        <button type="button" className="ewe-danger" data-testid="delete-node" onClick={onDelete}>Delete node</button>
      </footer>
    </aside>
  );
}
