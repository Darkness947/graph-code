import { Component } from 'react';

/** Renders `fallback` if drawing the canvas throws, so the workspace is never blank (spec 8.6 item 11). */
export default class CanvasErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
