import { getActivityVisual } from '../../utils/helpers'

export function ActivityItem({ item, showTime = true }) {
  const visual = getActivityVisual(item.action)

  return (
    <li className="activity-entry">
      <span className={`activity-icon activity-icon-${visual.kind}`}>{visual.glyph}</span>
      <div className="activity-copy">
        <p>
          <strong>{item.actor}</strong> {item.action}
        </p>
        {showTime && <small>{item.happened_at}</small>}
      </div>
    </li>
  )
}
