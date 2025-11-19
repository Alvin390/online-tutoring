import { Component } from 'react';
import logger from '@utils/logger';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    logger.error('React Error Boundary caught error', error, { errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-vh-100 d-flex align-items-center justify-content-center">
          <div className="text-center">
            <div className="mb-4">
              <i className="bi bi-exclamation-triangle-fill text-danger" style={{ fontSize: '4rem' }} />
            </div>
            <h2 className="mb-3">Something went wrong</h2>
            <p className="text-muted mb-4">
              {import.meta.env.DEV
                ? this.state.error?.message
                : 'Please refresh the page and try again.'}
            </p>
            <button
              className="btn btn-primary"
              onClick={() => window.location.reload()}
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
