export interface NodeCheckResult {
  installed: boolean;
  version?: string;
  meetsRequirements: boolean;
  npmAvailable: boolean;
  npmRegistry?: string;
  packageManager?: string;
}

export interface NodeInstallMethod {
  id: string;
  displayName: string;
  description?: string;
  command: string;
  platforms?: string[];
}
