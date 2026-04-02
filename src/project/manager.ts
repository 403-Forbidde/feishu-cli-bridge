/**
 * 项目管理
 * Project Manager
 *
 * 管理项目列表、当前项目、路径安全验证
 * 包含路径遍历防护（REVIEW.md 安全修复）
 */

import { homedir } from 'os';
import path from 'path';
import { realpath, access, constants, readFile, writeFile, mkdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import type { Project, ProjectConfig, ProjectStorage } from './types.js';
import { ProjectError, ProjectErrorCode } from './types.js';
import { logger } from '../core/logger.js';

const DEFAULT_ALLOWED_ROOT = '/';
const STORAGE_VERSION = 1;

/**
 * 路径遍历防护
 * 验证并规范化路径，确保在允许的根目录内
 *
 * @param inputPath - 输入路径（支持 ~ 展开）
 * @param allowedRoot - 允许的根目录
 * @returns 规范化后的绝对路径
 * @throws ProjectError 如果路径不合法或越界
 */
export async function sanitizePath(
  inputPath: string,
  allowedRoot: string = DEFAULT_ALLOWED_ROOT
): Promise<string> {
  // 1. 展开 ~ 和 ~user
  const expanded = inputPath.replace(/^~(?=$|\/|\\)/, homedir());

  // 2. 解析为绝对路径
  const resolved = path.resolve(expanded);

  // 3. 获取真实路径（解析符号链接）
  let realPath: string;
  try {
    realPath = await realpath(resolved);
  } catch {
    // 路径不存在，使用解析后的路径
    realPath = resolved;
  }

  // 4. 确保在允许的根目录内
  const relative = path.relative(allowedRoot, realPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new ProjectError(
      `路径 "${inputPath}" 超出允许的范围`,
      ProjectErrorCode.PATH_TRAVERSAL
    );
  }

  return realPath;
}

/**
 * 获取默认项目存储路径
 */
function getDefaultStoragePath(): string {
  const configDir = process.env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  return path.join(configDir, 'feishu-cli-bridge', 'projects.json');
}

/**
 * 项目管理器
 */
export class ProjectManager {
  private projects: Map<string, Project> = new Map();
  private currentProjectId: string | null = null;
  private allowedRoot: string;
  private maxProjects: number;
  private storagePath: string;
  private loaded = false;

  constructor(private config: ProjectConfig) {
    this.allowedRoot = config.allowedRoot || DEFAULT_ALLOWED_ROOT;
    this.maxProjects = config.maxProjects || 10;
    this.storagePath = config.storagePath || getDefaultStoragePath();
  }

  /**
   * 加载项目列表
   */
  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    try {
      // 确保存储目录存在
      const storageDir = path.dirname(this.storagePath);
      await mkdir(storageDir, { recursive: true });

      // 如果存储文件存在，读取它
      if (existsSync(this.storagePath)) {
        const data = await readFile(this.storagePath, 'utf-8');
        const storage: ProjectStorage = JSON.parse(data);

        // 验证版本
        if (storage.version !== STORAGE_VERSION) {
          logger.warn({ version: storage.version, expected: STORAGE_VERSION }, '项目存储版本不匹配');
          // 尝试迁移或重置
          await this.migrateStorage(storage);
          return;
        }

        // 加载项目
        this.projects.clear();
        for (const project of storage.projects) {
          // 验证路径仍然有效
          const isValid = await this.validateProjectPath(project.path);
          if (isValid) {
            this.projects.set(project.id, project);
          } else {
            logger.warn({ projectId: project.id, path: project.path }, '项目路径无效，跳过加载');
          }
        }

        // 恢复当前项目
        if (storage.currentProjectId && this.projects.has(storage.currentProjectId)) {
          this.currentProjectId = storage.currentProjectId;
        }

        logger.info(
          { count: this.projects.size, storagePath: this.storagePath },
          '项目配置加载成功'
        );
      } else {
        logger.info({ storagePath: this.storagePath }, '项目存储文件不存在，使用空配置');
      }

      this.loaded = true;
    } catch (error) {
      logger.error({ error, storagePath: this.storagePath }, '项目配置加载失败');
      // 失败时使用空配置
      this.projects.clear();
      this.currentProjectId = null;
      this.loaded = true;
    }
  }

  /**
   * 保存项目列表
   */
  async save(): Promise<void> {
    try {
      const storage: ProjectStorage = {
        projects: Array.from(this.projects.values()),
        currentProjectId: this.currentProjectId,
        version: STORAGE_VERSION,
      };

      // 确保存储目录存在
      const storageDir = path.dirname(this.storagePath);
      await mkdir(storageDir, { recursive: true });

      // 写入文件
      await writeFile(this.storagePath, JSON.stringify(storage, null, 2), 'utf-8');

      logger.debug({ storagePath: this.storagePath, count: this.projects.size }, '项目配置已保存');
    } catch (error) {
      logger.error({ error, storagePath: this.storagePath }, '项目配置保存失败');
      throw new ProjectError(
        '无法保存项目配置',
        ProjectErrorCode.STORAGE_ERROR,
        error
      );
    }
  }

  /**
   * 迁移存储格式
   */
  private async migrateStorage(storage: Partial<ProjectStorage>): Promise<void> {
    // 目前只有一个版本，未来可以在这里添加迁移逻辑
    logger.info('执行存储格式迁移');
    this.projects.clear();
    this.currentProjectId = null;
    await this.save();
  }

  /**
   * 验证项目路径是否有效
   */
  private async validateProjectPath(projectPath: string): Promise<boolean> {
    try {
      // 检查路径遍历
      await sanitizePath(projectPath, this.allowedRoot);

      // 检查路径是否存在且可访问
      await access(projectPath, constants.R_OK | constants.X_OK);

      // 检查是否为目录
      const stats = await stat(projectPath);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * 添加项目
   * @param inputPath - 项目路径
   * @param name - 项目名称（可选，默认使用目录名）
   * @returns 创建的项目
   */
  async addProject(inputPath: string, name?: string): Promise<Project> {
    // 路径安全验证
    const resolvedPath = await sanitizePath(inputPath, this.allowedRoot);

    // 验证路径存在或为文件，如果不存在则自动创建
    try {
      const stats = await stat(resolvedPath);
      if (!stats.isDirectory()) {
        throw new ProjectError(
          `路径不是目录: ${inputPath}`,
          ProjectErrorCode.PATH_NOT_DIRECTORY
        );
      }
      await access(resolvedPath, constants.R_OK | constants.X_OK);
    } catch (error) {
      if (error instanceof ProjectError) throw error;

      // 路径不存在，尝试自动创建
      try {
        await mkdir(resolvedPath, { recursive: true });
        logger.info({ path: resolvedPath }, '自动创建项目目录');
      } catch (mkdirError) {
        throw new ProjectError(
          `无法创建目录: ${inputPath}，请检查权限`,
          ProjectErrorCode.PATH_NOT_EXIST,
          mkdirError
        );
      }
    }

    // 检查是否已存在
    for (const project of this.projects.values()) {
      if (project.path === resolvedPath) {
        throw new ProjectError(
          `项目已存在: ${project.name}`,
          ProjectErrorCode.PROJECT_EXISTS
        );
      }
    }

    // 检查最大项目数
    if (this.projects.size >= this.maxProjects) {
      throw new ProjectError(
        `已达到最大项目数限制 (${this.maxProjects})`,
        ProjectErrorCode.MAX_PROJECTS_REACHED
      );
    }

    // 生成项目 ID 和名称
    const projectName = name || path.basename(resolvedPath);
    const id = `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const project: Project = {
      id,
      name: projectName,
      displayName: projectName,
      path: resolvedPath,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    this.projects.set(id, project);
    await this.save();

    logger.info({ projectId: id, name: projectName, path: resolvedPath }, '项目已添加');
    return project;
  }

  /**
   * 切换当前项目
   * @param identifier - 项目 ID 或名称
   * @returns 是否成功
   */
  async switchProject(identifier: string): Promise<boolean> {
    // 先按 ID 查找
    let project = this.projects.get(identifier);

    // 再按名称查找
    if (!project) {
      for (const p of this.projects.values()) {
        if (p.name === identifier) {
          project = p;
          break;
        }
      }
    }

    if (!project) {
      return false;
    }

    // 验证项目路径仍然有效
    const isValid = await this.validateProjectPath(project.path);
    if (!isValid) {
      logger.warn({ projectId: project.id, path: project.path }, '项目路径已无效');
      throw new ProjectError(
        `项目路径已无效: ${project.path}`,
        ProjectErrorCode.PATH_NOT_EXIST
      );
    }

    this.currentProjectId = project.id;
    project.updatedAt = Date.now();
    await this.save();

    logger.info({ projectId: project.id, name: project.name }, '切换到项目');
    return true;
  }

  /**
   * 获取当前项目
   */
  async getCurrentProject(): Promise<Project | null> {
    if (!this.currentProjectId) {
      return null;
    }
    return this.projects.get(this.currentProjectId) || null;
  }

  /**
   * 获取当前工作目录
   */
  async getCurrentWorkingDir(): Promise<string> {
    const project = await this.getCurrentProject();
    return project?.path || this.allowedRoot;
  }

  /**
   * 列出所有项目
   */
  async listProjects(): Promise<Project[]> {
    return Array.from(this.projects.values()).sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
  }

  /**
   * 获取项目
   * @param identifier - 项目 ID 或名称
   */
  async getProject(identifier: string): Promise<Project | null> {
    // 按 ID 查找
    const byId = this.projects.get(identifier);
    if (byId) return byId;

    // 按名称查找
    for (const p of this.projects.values()) {
      if (p.name === identifier) {
        return p;
      }
    }

    return null;
  }

  /**
   * 删除项目
   * @param identifier - 项目 ID 或名称
   * @returns 是否成功
   */
  async deleteProject(identifier: string): Promise<boolean> {
    let projectId: string | null = null;

    // 按 ID 查找
    if (this.projects.has(identifier)) {
      projectId = identifier;
    } else {
      // 按名称查找
      for (const [id, p] of this.projects.entries()) {
        if (p.name === identifier) {
          projectId = id;
          break;
        }
      }
    }

    if (!projectId) {
      return false;
    }

    this.projects.delete(projectId);
    if (this.currentProjectId === projectId) {
      this.currentProjectId = null;
    }

    await this.save();
    logger.info({ projectId }, '项目已删除');
    return true;
  }

  /**
   * 重命名项目
   * @param identifier - 项目 ID 或名称
   * @param newName - 新名称
   * @returns 是否成功
   */
  async renameProject(identifier: string, newName: string): Promise<boolean> {
    const project = await this.getProject(identifier);
    if (!project) {
      return false;
    }

    project.name = newName;
    project.displayName = newName;
    project.updatedAt = Date.now();

    await this.save();
    logger.info({ projectId: project.id, newName }, '项目已重命名');
    return true;
  }

  /**
   * 获取项目数量
   */
  getProjectCount(): number {
    return this.projects.size;
  }

  /**
   * 获取当前项目 ID
   */
  getCurrentProjectId(): string | null {
    return this.currentProjectId;
  }

  /**
   * 获取版本控制信息
   * 检测项目是否使用 Git 及其分支信息
   * @param projectPath - 项目路径
   * @returns VCS 信息字符串，如 "Git (main)" 或 undefined
   */
  async getVCSInfo(projectPath: string): Promise<string | undefined> {
    try {
      const gitDir = path.join(projectPath, '.git');
      const gitHeadPath = path.join(gitDir, 'HEAD');

      // 检查 .git 目录是否存在
      try {
        await access(gitDir, constants.R_OK);
        await access(gitHeadPath, constants.R_OK);
      } catch {
        return undefined;
      }

      // 读取 HEAD 文件获取分支信息
      const headContent = await readFile(gitHeadPath, 'utf-8');
      const refMatch = headContent.match(/ref: refs\/heads\/(.+)/);

      if (refMatch) {
        const branch = refMatch[1].trim();
        return `Git (${branch})`;
      }

      // 可能是 detached HEAD 状态，显示 commit 短哈希
      const shortHash = headContent.trim().slice(0, 7);
      return `Git (${shortHash}...)`;
    } catch {
      return undefined;
    }
  }
}

/**
 * 创建项目管理器实例
 */
export function createProjectManager(config: ProjectConfig): ProjectManager {
  return new ProjectManager(config);
}
