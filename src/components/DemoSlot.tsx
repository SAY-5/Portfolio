import { Suspense } from 'react';
import { demos } from '../lib/demoRegistry';

// Renders the registered demo for a project, or null if none exists.
// Kept as its own component so the detail page never assigns a component to a
// local during its own render. Demos are lazy chunks, so a short skeleton
// holds the space while one downloads.
export default function DemoSlot({ name }: { name: string }) {
  const Demo = demos[name];
  if (!Demo) return null;
  return (
    <section className="detail__demo" aria-label="Interactive demo">
      <Suspense
        fallback={
          <div className="demo-loading" role="status" aria-live="polite">
            <span className="demo-loading__bar" />
            <span className="demo-loading__text mono">Loading the demo</span>
          </div>
        }
      >
        <Demo />
      </Suspense>
    </section>
  );
}
