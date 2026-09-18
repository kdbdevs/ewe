import type { ActivityItem } from './useExecution';

// SPEC §10: realtime execution activity panel. Fed by the ordered execution events
// arriving over SSE (see useExecution), never by polling.
export default function ActivityPanel({ items, status }: { items: ActivityItem[]; status?: string }) {
  return <section className="ewe-activity" aria-label="Execution activity">
    <h2>Activity{status ? ` · ${status}` : ''}</h2>
    {items.length === 0 ? <p className="activity-empty">No events yet — run the workflow.</p> : (
      <ol data-testid="activity-list">
        {items.map(item => <li key={item.id} data-testid="activity-item" data-kind={item.label.replace(/.*\s/, '')}>
          <time>{item.at}</time><span>{item.label}</span>{item.detail ? <small>{item.detail}</small> : null}
        </li>)}
      </ol>
    )}
  </section>;
}
