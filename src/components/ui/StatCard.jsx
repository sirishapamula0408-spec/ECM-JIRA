export function StatCard({ label, value }) {
  return (
    <article className="stat">
      <p>{label}</p>
      <strong>{value}</strong>
    </article>
  )
}
