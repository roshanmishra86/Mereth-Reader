import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  onReturnToLibrary?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class RendererErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('PDF Renderer Exception Caught:', error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div
          className="renderer-error-fallback"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            padding: '40px',
            background: '#605d5d',
            color: '#fff',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              maxWidth: '500px',
              padding: '24px',
              background: '#2d2b2b',
              borderTop: '4px solid #ec3013',
              borderRadius: '4px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            }}
          >
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>⚠️</div>
            <h3 style={{ margin: '0 0 10px', fontSize: '18px', color: '#ffc4b8' }}>
              PDF Renderer Encountered an Error
            </h3>
            <p style={{ fontSize: '12px', color: '#d7d3d3', lineHeight: 1.5, marginBottom: '16px' }}>
              {this.state.error?.message ||
                'An unexpected error occurred while rendering the PDF document canvas.'}
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button className="button primary" onClick={this.handleRetry}>
                Retry Rendering
              </button>
              {this.props.onReturnToLibrary && (
                <button className="button secondary" onClick={this.props.onReturnToLibrary}>
                  Return to Library
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
