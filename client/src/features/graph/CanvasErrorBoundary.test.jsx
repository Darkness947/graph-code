import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CanvasErrorBoundary from './CanvasErrorBoundary.jsx';

function Broken() {
  throw new Error('render failed');
}

describe('CanvasErrorBoundary', () => {
  it('shows the fallback instead of a blank canvas when drawing throws', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <CanvasErrorBoundary fallback={<p>fallback list</p>}>
        <Broken />
      </CanvasErrorBoundary>,
    );
    expect(screen.getByText('fallback list')).toBeInTheDocument();
    quiet.mockRestore();
  });

  it('renders its children when nothing throws', () => {
    render(
      <CanvasErrorBoundary fallback={<p>fallback list</p>}>
        <p>canvas</p>
      </CanvasErrorBoundary>,
    );
    expect(screen.getByText('canvas')).toBeInTheDocument();
  });
});
