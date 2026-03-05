import { Component } from 'react'

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary" role="alert">
          <div className="error-boundary-content">
            <h1>Something went wrong</h1>
            <p>An unexpected error occurred. Please try again.</p>
            {this.state.error && (
              <pre className="error-boundary-detail">{this.state.error.message}</pre>
            )}
            <button className="btn btn-primary" onClick={this.handleReset}>
              Try again
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
