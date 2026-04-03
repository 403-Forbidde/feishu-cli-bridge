export interface CLICheckResult {
  installed: boolean;
  version?: string;
  path?: string;
  meetsRequirements: boolean;
}

export interface InstallMethod {
  id: string;
  displayName: string;
  description?: string;
  command?: string;
  platform?: string[];
}

export interface InstallOptions {
  global?: boolean;
  version?: string;
  mirror?: string;
}

export interface InstallResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface AuthStatus {
  authenticated: boolean;
  user?: string;
  provider?: string;
}

export interface CLIConfig {
  enabled: boolean;
  command: string;
  default_model: string;
  // Claude Code 特有配置
  context_window?: number | string;
  permission_mode?: string;
  allowed_tools?: string[];
  timeout?: number;
  [key: string]: unknown;
}

export interface ICLIProvider {
  readonly id: string;
  readonly displayName: string;
  readonly adapterName: string;
  readonly websiteUrl: string;
  readonly docsUrl: string;
  readonly minVersion?: string;
  readonly recommendedModels: Array<{ id: string; name: string; description?: string }>;

  check(): Promise<CLICheckResult>;
  getInstallMethods(): InstallMethod[];
  install(method: string, options?: InstallOptions): Promise<InstallResult>;
  verify(): Promise<boolean>;
  getAuthStatus(): Promise<AuthStatus>;
  login(): Promise<boolean>;
  fetchModels(): Promise<Array<{ id: string; name: string; provider?: string; isFree?: boolean }>>;
  getDefaultConfig(): CLIConfig;
  getUserDefaultModel(): Promise<string | null>;
}
