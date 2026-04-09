import { parse as parseYaml } from 'yaml';

export interface WorkflowTaskDef {
  id: string;
  description: string;
  produce: {
    type: 'plan' | 'implement';
    role: string;
    prompt?: string;
  };
  review?: {
    role: string;
    prompt?: string;
  };
  files?: string[];
  dependsOn?: string[];
}

export interface WorkflowPlan {
  name: string;
  config: {
    onComplete: 'pr' | 'notify' | 'merge' | 'stop';
    branch?: string;
    baseBranch?: string;
  };
  tasks: WorkflowTaskDef[];
}

export interface ValidationError {
  field: string;
  message: string;
}

export function parsePlanYaml(yamlContent: string): WorkflowPlan {
  const raw = parseYaml(yamlContent);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Invalid plan: expected a YAML object');
  }
  return raw as WorkflowPlan;
}

const VALID_ROLES = ['orchestrator', 'implementer', 'reviewer'];
const VALID_ON_COMPLETE = ['pr', 'notify', 'merge', 'stop'];
const VALID_PRODUCE_TYPES = ['plan', 'implement'];

export function validatePlan(plan: WorkflowPlan): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!plan.name || typeof plan.name !== 'string') {
    errors.push({ field: 'name', message: 'name is required' });
  }

  if (!plan.config || typeof plan.config !== 'object') {
    errors.push({ field: 'config', message: 'config is required' });
  } else if (!VALID_ON_COMPLETE.includes(plan.config.onComplete)) {
    errors.push({
      field: 'config.onComplete',
      message: `must be one of: ${VALID_ON_COMPLETE.join(', ')}`,
    });
  }

  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
    errors.push({ field: 'tasks', message: 'at least one task is required' });
    return errors;
  }

  const ids = new Set<string>();
  for (const task of plan.tasks) {
    if (ids.has(task.id)) {
      errors.push({ field: `tasks.${task.id}`, message: `duplicate task id: ${task.id}` });
    }
    ids.add(task.id);
  }

  for (const task of plan.tasks) {
    if (!task.id || typeof task.id !== 'string') {
      errors.push({ field: 'tasks[].id', message: 'task id is required' });
    }
    if (!task.description) {
      errors.push({ field: `tasks.${task.id}.description`, message: 'description is required' });
    }
    if (!task.produce) {
      errors.push({ field: `tasks.${task.id}.produce`, message: 'produce is required' });
    } else {
      if (!VALID_PRODUCE_TYPES.includes(task.produce.type)) {
        errors.push({
          field: `tasks.${task.id}.produce.type`,
          message: `must be one of: ${VALID_PRODUCE_TYPES.join(', ')}`,
        });
      }
      if (!VALID_ROLES.includes(task.produce.role)) {
        errors.push({
          field: `tasks.${task.id}.produce.role`,
          message: `must be one of: ${VALID_ROLES.join(', ')}`,
        });
      }
    }
    if (task.review && !VALID_ROLES.includes(task.review.role)) {
      errors.push({
        field: `tasks.${task.id}.review.role`,
        message: `must be one of: ${VALID_ROLES.join(', ')}`,
      });
    }
    if (task.dependsOn) {
      for (const dep of task.dependsOn) {
        if (!ids.has(dep)) {
          errors.push({
            field: `tasks.${task.id}.dependsOn`,
            message: `references unknown task: ${dep}`,
          });
        }
      }
    }
  }

  // Cycle detection via DFS
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const taskMap = new Map(plan.tasks.map(t => [t.id, t]));

  function hasCycle(id: string): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const task = taskMap.get(id);
    for (const dep of task?.dependsOn ?? []) {
      if (ids.has(dep) && hasCycle(dep)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }

  for (const task of plan.tasks) {
    if (hasCycle(task.id)) {
      errors.push({ field: 'tasks', message: `cyclic dependency detected involving task: ${task.id}` });
      break;
    }
  }

  return errors;
}
