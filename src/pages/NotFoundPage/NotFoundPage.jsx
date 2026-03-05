import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="not-found-page" role="main">
      <h1>404</h1>
      <p>The page you are looking for does not exist.</p>
      <Link to="/" className="btn btn-primary">Go to Dashboard</Link>
    </div>
  )
}
