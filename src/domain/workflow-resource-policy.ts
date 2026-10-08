export interface WorkflowResourceIdentity {
  modelsSha256: string;
  template: { sha256: string; id: string; version: string };
  manifest: { schemaVersion: number; version: string; sha256: string };
}

export function workflowResourcesChanged(
  build: WorkflowResourceIdentity | null,
  current: WorkflowResourceIdentity | null,
): boolean {
  if (!build || !current) return true;
  return (
    build.modelsSha256 !== current.modelsSha256 ||
    build.template?.sha256 !== current.template.sha256 ||
    build.template?.id !== current.template.id ||
    build.template?.version !== current.template.version ||
    build.manifest?.schemaVersion !== current.manifest.schemaVersion ||
    build.manifest?.version !== current.manifest.version ||
    build.manifest?.sha256 !== current.manifest.sha256
  );
}
