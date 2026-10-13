import { Injectable } from '@nestjs/common';
import type { AnyStateMachine, AnyStateNode } from 'xstate';
import { z } from 'zod';
import { toneSchema } from '@/common/domain/schemas';
import type { Tone } from '@/common/domain/vocabulary';
import { sentenceCase } from './enum.registry';

/**
 * Display metadata for a workflow (`GET /meta/workflows/{name}`), registered by the owning
 * slice with `CoreExtensionsModule.forFeature({ workflows: [...] })`. States and transitions
 * are read from the machine; this adds labels, tones and actor names.
 */
export interface WorkflowMeta {
  /** API WorkflowName, e.g. `training_attendee`. */
  name: string;
  label: string;
  machine: AnyStateMachine;
  /** Possible entry states (after a transient `submitted` state, if any). */
  initialStates: string[];
  /** States to show, in display order. Transient states are simply left out. */
  states: Record<string, { label: string; tone: Tone }>;
  /** Event (= action) labels and who may trigger them, e.g. `['Approver', 'Deputy', 'Manager chain']`. */
  events: Record<string, { label?: string; actors: string[] }>;
}

export const workflowDefinitionSchema = z
  .object({
    name: z.string(),
    label: z.string(),
    initialStates: z.array(z.string()),
    states: z.array(z.object({ id: z.string(), label: z.string(), tone: toneSchema, terminal: z.boolean() })),
    transitions: z.array(
      z.object({ from: z.string(), to: z.string(), event: z.string(), label: z.string(), actors: z.array(z.string()) }),
    ),
  })
  .meta({ id: 'WorkflowDefinition' });

export type WorkflowDefinitionView = z.infer<typeof workflowDefinitionSchema>;

/** Flattens `machine.root` into `{ path -> stateNode }` (nested states as dotted paths). */
function collectStates(node: AnyStateNode, prefix = ''): Map<string, AnyStateNode> {
  const result = new Map<string, AnyStateNode>();
  for (const [key, child] of Object.entries(node.states)) {
    const path = prefix ? `${prefix}.${key}` : key;
    result.set(path, child);
    for (const [nested, value] of collectStates(child, path)) result.set(nested, value);
  }
  return result;
}

export function describeWorkflow(meta: WorkflowMeta): WorkflowDefinitionView {
  const nodes = collectStates(meta.machine.root);
  const pathById = new Map([...nodes.entries()].map(([path, node]) => [node.id, path]));
  const shown = Object.keys(meta.states);

  const transitions: WorkflowDefinitionView['transitions'] = [];
  for (const from of shown) {
    const node = nodes.get(from);
    if (!node) throw new Error(`Workflow "${meta.name}": unknown state "${from}"`);
    for (const [event, definitions] of node.transitions) {
      if (!event || event.startsWith('xstate.')) continue;
      for (const definition of definitions) {
        for (const target of definition.target ?? []) {
          const to = pathById.get(target.id);
          if (!to || !shown.includes(to)) continue;
          if (transitions.some((t) => t.from === from && t.to === to && t.event === event)) continue;
          const eventMeta = meta.events[event];
          transitions.push({
            from,
            to,
            event,
            label: eventMeta?.label ?? sentenceCase(event),
            actors: eventMeta?.actors ?? [],
          });
        }
      }
    }
  }

  return {
    name: meta.name,
    label: meta.label,
    initialStates: meta.initialStates,
    states: shown.map((id) => ({
      id,
      label: meta.states[id].label,
      tone: meta.states[id].tone,
      terminal: nodes.get(id)?.type === 'final',
    })),
    transitions,
  };
}

/** Feeds `GET /meta/workflows`. */
@Injectable()
export class WorkflowRegistry {
  private readonly workflows = new Map<string, WorkflowMeta>();

  register(meta: WorkflowMeta): void {
    if (this.workflows.has(meta.name)) throw new Error(`Workflow "${meta.name}" is registered twice`);
    describeWorkflow(meta); // validate eagerly
    this.workflows.set(meta.name, meta);
  }

  list(): { name: string; label: string }[] {
    return [...this.workflows.values()].map((w) => ({ name: w.name, label: w.label }));
  }

  describe(name: string): WorkflowDefinitionView | undefined {
    const meta = this.workflows.get(name);
    return meta ? describeWorkflow(meta) : undefined;
  }
}
