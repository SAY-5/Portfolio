import { demos } from './index';

// Renders the registered demo for a project, or null if none exists.
// Kept as its own component so the detail page never assigns a component to a
// local during its own render.
export default function DemoSlot({ name }: { name: string }) {
  const Demo = demos[name];
  if (!Demo) return null;
  return (
    <section className="detail__demo" aria-label="Interactive demo">
      <Demo />
    </section>
  );
}
