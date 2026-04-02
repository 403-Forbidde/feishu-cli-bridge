import { execa } from 'execa';
import semver from 'semver';
import process from 'node:process';
import { existsSync } from 'node:fs';

import type { NodeCheckResult, NodeInstallMethod } from './interface.js';

const MIN_NODE_VERSION = '20.0.0';

export async function checkNode(): Promise<NodeCheckResult> {
  let installed = false;
  let version: string | undefined;
  let meetsRequirements = false;
  let npmAvailable = false;
  let npmRegistry: string | undefined;
  let packageManager: string | undefined;

  try {
    const { stdout } = await execa('node', ['--version'], { reject: false });
    if (stdout && stdout.startsWith('v')) {
      installed = true;
      version = stdout.trim().slice(1);
      meetsRequirements = semver.gte(version, MIN_NODE_VERSION);
    }
  } catch {
    installed = false;
  }

  try {
    const { stdout } = await execa('npm', ['--version'], { reject: false });
    if (stdout && stdout.trim()) {
      npmAvailable = true;
    }
  } catch {
    npmAvailable = false;
  }

  if (npmAvailable) {
    try {
      const { stdout } = await execa('npm', ['config', 'get', 'registry'], { reject: false });
      if (stdout && stdout.trim()) {
        npmRegistry = stdout.trim();
      }
    } catch {
      // ignore
    }
  }

  packageManager = await detectPackageManager();

  return {
    installed,
    version,
    meetsRequirements,
    npmAvailable,
    npmRegistry,
    packageManager,
  };
}

async function detectPackageManager(): Promise<string | undefined> {
  const platform = process.platform;
  const managers: Array<{ cmd: string; name: string }> =
    platform === 'darwin'
      ? [
          { cmd: 'brew', name: 'brew' },
          { cmd: 'port', name: 'port' },
        ]
      : platform === 'linux'
        ? [
            { cmd: 'apt-get', name: 'apt' },
            { cmd: 'apt', name: 'apt' },
            { cmd: 'dnf', name: 'dnf' },
            { cmd: 'yum', name: 'yum' },
            { cmd: 'pacman', name: 'pacman' },
            { cmd: 'zypper', name: 'zypper' },
          ]
        : platform === 'win32'
          ? [
              { cmd: 'winget', name: 'winget' },
              { cmd: 'choco', name: 'choco' },
            ]
          : [];

  for (const { cmd, name } of managers) {
    try {
      await execa(cmd, ['--version'], { reject: false });
      return name;
    } catch {
      continue;
    }
  }

  return undefined;
}

export function getNodeInstallMethods(): NodeInstallMethod[] {
  const platform = process.platform;
  const methods: NodeInstallMethod[] = [];

  methods.push({
    id: 'official',
    displayName: 'NodeSource / 官方脚本',
    description: '使用 NodeSource 或官方安装脚本（推荐）',
    command: 'curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs',
    platforms: ['linux'],
  });

  methods.push({
    id: 'nvm',
    displayName: 'nvm (Node Version Manager)',
    description: '使用 nvm 安装并管理 Node 版本',
    command: 'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash && nvm install 20',
    platforms: ['linux', 'darwin'],
  });

  methods.push({
    id: 'fnm',
    displayName: 'fnm (Fast Node Manager)',
    description: '使用 fnm 安装并管理 Node 版本',
    command: 'curl -fsSL https://fnm.vercel.app/install | bash && fnm install 20',
    platforms: ['linux', 'darwin', 'win32'],
  });

  if (platform === 'darwin' || existsSync('/usr/local/bin/brew') || existsSync('/opt/homebrew/bin/brew')) {
    methods.push({
      id: 'brew',
      displayName: 'Homebrew',
      description: '使用 Homebrew 安装 Node.js',
      command: 'brew install node@20',
      platforms: ['darwin', 'linux'],
    });
  }

  methods.push({
    id: 'package-manager',
    displayName: '系统包管理器',
    description: '使用系统自带的包管理器安装',
    command: 'sudo apt-get update && sudo apt-get install -y nodejs npm',
    platforms: ['linux'],
  });

  return methods.filter((m) => !m.platforms || m.platforms.includes(platform));
}
