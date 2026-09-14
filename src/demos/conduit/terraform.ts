// Model of terraform/: fileset(connectors_dir, "*.yaml") feeds yamldecode and
// module.connector for_each. Each connector gets a work queue, a DLQ joined
// by a redrive policy, a quarantine queue, a least-privilege IAM policy, role
// and attachment for its worker, and one SSM SecureString per secret. The
// shared idempotency table exists once. A plan diff of one new YAML file is
// exactly that connector's resources.
import { dlqName, loadSpec, quarantineName, queueName, type ConnectorSpec } from './specs';

export interface PlannedResource {
  address: string;
  detail: string;
}

export function connectorResources(spec: ConnectorSpec): PlannedResource[] {
  const mod = `module.connector["${spec.name}"]`;
  const q = queueName(spec.name);
  const out: PlannedResource[] = [
    { address: `${mod}.aws_iam_policy.worker`, detail: `sqs on ${q}, ${dlqName(spec.name)}, ${quarantineName(spec.name)}; dynamodb Put/Get/Update/Delete on conduit-idempotency` },
    { address: `${mod}.aws_iam_role.worker`, detail: 'sts:AssumeRole from ecs-tasks.amazonaws.com' },
    { address: `${mod}.aws_iam_role_policy_attachment.worker`, detail: `${q}-worker` },
  ];
  for (const [logical, env] of Object.entries(spec.secrets).sort()) {
    out.push({ address: `${mod}.aws_ssm_parameter.secret["${logical}"]`, detail: `/conduit/${spec.name}/${env} SecureString` });
  }
  out.push(
    { address: `${mod}.module.queue.aws_sqs_queue.dlq`, detail: `${dlqName(spec.name)}, retention 1209600 s` },
    { address: `${mod}.module.queue.aws_sqs_queue.main`, detail: `${q}, redrive after maxReceiveCount ${spec.queue.maxReceiveCount}, visibility ${spec.queue.visibilityTimeoutSeconds} s` },
    { address: `${mod}.module.queue.aws_sqs_queue.quarantine`, detail: `${quarantineName(spec.name)}, written by the worker, never redriven into` },
    { address: `${mod}.module.queue.aws_sqs_queue_redrive_allow_policy.dlq`, detail: `byQueue from ${q}` },
  );
  return out;
}

const TABLE: PlannedResource = { address: 'module.idempotency_table.aws_dynamodb_table.this', detail: 'conduit-idempotency, pk, ttl expires_at' };

export function plan(files: Record<string, string>): PlannedResource[] {
  return [TABLE, ...Object.keys(files).sort().flatMap((name) => connectorResources(loadSpec(name, files[name])))];
}

export function diffPlans(before: PlannedResource[], after: PlannedResource[]): { add: PlannedResource[]; destroy: PlannedResource[]; summary: string } {
  const b = new Set(before.map((r) => r.address));
  const a = new Set(after.map((r) => r.address));
  const add = after.filter((r) => !b.has(r.address));
  const destroy = before.filter((r) => !a.has(r.address));
  return { add, destroy, summary: `Plan: ${add.length} to add, 0 to change, ${destroy.length} to destroy.` };
}
