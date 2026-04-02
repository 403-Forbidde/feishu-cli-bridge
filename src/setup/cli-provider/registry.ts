import type { ICLIProvider } from './interface.js';

const registry = new Map<string, ICLIProvider>();

export function registerProvider(provider: ICLIProvider): void {
  registry.set(provider.id, provider);
}

export function getProvider(id: string): ICLIProvider | undefined {
  return registry.get(id);
}

export function getAllProviders(): ICLIProvider[] {
  return Array.from(registry.values());
}
