import type { Workflow } from '../model';
import { workflowDocument } from '../transfer';
import { api } from '../api/client';

interface TransferProps {
  workflow?: Workflow;
  disabled: boolean;
  mayLeave: () => boolean;
  onImported: (workflow: Workflow) => Promise<void>;
  onMessage: (message: string) => void;
}
export default function WorkflowTransfer({ workflow, disabled, mayLeave, onImported, onMessage }: TransferProps) {
  const exportFile = () => {
    if (!workflow) return;
    try {
      const raw = JSON.stringify(workflowDocument(workflow), null, 2);
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `${workflow.id}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onMessage('Exported workflow JSON');
    } catch (error) { onMessage(String(error)); }
  };
  const importFile = async (file?: File) => {
    if (!file || !mayLeave()) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('Import exceeds 1 MiB');
      let parsed: unknown;
      try { parsed = JSON.parse(await file.text()); } catch { throw new Error('Invalid JSON: select a workflow JSON file'); }
      const imported = await api.import(workflowDocument(parsed));
      await onImported(imported); onMessage('Imported as a new workflow');
    } catch (error) { onMessage(String(error)); }
  };
  return <div className="workflow-transfer">
    <button type="button" data-testid="export-workflow" disabled={disabled || !workflow} onClick={exportFile}>Export JSON</button>
    <label>Import JSON<input aria-label="Import workflow JSON" data-testid="import-workflow" type="file" accept=".json,application/json" disabled={disabled} onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ''; }} /></label>
  </div>;
}
