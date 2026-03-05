export function LoadingSkeleton() {
  return (
    <div className="loading-skeleton" aria-busy="true" aria-label="Loading workspace">
      <div className="skeleton-stats">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton-card">
            <div className="skeleton-line skeleton-short" />
            <div className="skeleton-line skeleton-number" />
          </div>
        ))}
      </div>
      <div className="skeleton-panels">
        <div className="skeleton-panel">
          <div className="skeleton-line skeleton-heading" />
          <div className="skeleton-line skeleton-full" />
          <div className="skeleton-line skeleton-full" />
          <div className="skeleton-line skeleton-medium" />
        </div>
        <div className="skeleton-panel">
          <div className="skeleton-line skeleton-heading" />
          <div className="skeleton-line skeleton-full" />
          <div className="skeleton-line skeleton-medium" />
        </div>
      </div>
    </div>
  )
}
