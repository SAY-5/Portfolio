import type { ComponentType } from 'react';
import CodelensDemo from './codelens';
import AgentdeskDemo from './agentdesk';
import TaskboardDemo from './taskboard';
import ShopflowDemo from './shopflow';

// Maps a project `name` to its interactive demo component. A project listed
// here renders its demo in the detail-page slot; anything absent keeps the
// placeholder. Drop a new file in this folder and add one line to register it.
export const demos: Record<string, ComponentType> = {
  codelens: CodelensDemo,
  agentdesk: AgentdeskDemo,
  taskboard: TaskboardDemo,
  shopflow: ShopflowDemo,
};

export function hasDemo(name: string): boolean {
  return name in demos;
}
