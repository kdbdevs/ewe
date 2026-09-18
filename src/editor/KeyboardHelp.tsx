import { useEffect } from 'react';

interface HelpProps {
  open: boolean;
  onClose: () => void;
}

const shortcuts = [
  { keys: ['Ctrl/⌘', 'S'], label: 'Save workflow' },
  { keys: ['Ctrl/⌘', 'Enter'], label: 'Run workflow' },
  { keys: ['Esc'], label: 'Deselect node' },
  { keys: ['Backspace', 'Delete'], label: 'Delete selected node/edge' },
  { keys: ['?'], label: 'Toggle this help' },
  { keys: ['Scroll'], label: 'Zoom canvas' },
  { keys: ['Drag canvas'], label: 'Pan' },
];

export default function KeyboardHelp({ open, onClose }: HelpProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ewe-modal-overlay" data-testid="keyboard-help-modal" onClick={onClose}>
      <div className="ewe-modal" role="dialog" aria-label="Keyboard shortcuts" onClick={e => e.stopPropagation()}>
        <header>
          <h2>Keyboard Shortcuts</h2>
          <button type="button" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <dl>
          {shortcuts.map(s => (
            <div key={s.label} className="ewe-kbd-row">
              <dt>{s.keys.map((k, i) => <kbd key={i}>{k}</kbd>)}</dt>
              <dd>{s.label}</dd>
            </div>
          ))}
        </dl>
        <footer>
          <button type="button" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
