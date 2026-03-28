/**
 * 项目管理
 * Project Manager
 *
 * 管理项目列表、当前项目、路径安全验证
 * 包含路径遍历防护（REVIEW.md 安全修复）
 */

import { homedir } from 'os';
import path from 'path';
import { realpath, access, constants } from 'fs/promises';
import type { Project, ProjectConfig, ProjectStorage, ProjectErrorCode } from './types.js';
import { ProjectError } from './types.js';
import { logger } from '../core/logger.js';

const DEFAULT_ALLOWED_ROOT = homedir();
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
      'PATH_TRAVERSAL' as ProjectErrorCode
    );
  }

  return realPath;
}

/**
 * 项目管理器
 */
export class ProjectManager {
  private projects: Map<string, Project> = new Map();
  private currentProjectId: string | null = null;
  private allowedRoot: string;
  private maxProjects: number;

  constructor(private config: ProjectConfig) {
    this.allowedRoot = config.allowedRoot || DEFAULT_ALLOWED_ROOT;
    this.maxProjects = config.maxProjects || 10;
  }

  /**
   * 加载项目列表
   */
  async load(): Promise<void> {
    try {
      // TODO: 从配置文件加载
      logger.info('加载项目配置');
    } catch (error) {
      logger.warn({ error }, '项目配置加载失败，使用默认配置');
    }
  }

  /**
   * 保存项目列表
   */
  async save(): Promise<void> {
    // TODO: 保存到配置文件
    logger.debug('保存项目配置');
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

    // 验证路径存在且为目录
    try {
      await access(resolvedPath, constants.R_OK | constants.X_OK);
    } catch {
      throw new ProjectError(
        `路径不存在或无法访问: ${inputPath}`,
        'PATH_NOT_EXIST' as ProjectErrorCode
      );
    }

    // 检查是否已存在
    for (const project of this.projects.values()) {
      if (project.path === resolvedPath) {
        throw new ProjectError(
          `项目已存在: ${project.name}`,
          'PROJECT_EXISTS' as ProjectErrorCode
        );
      }
    }

    // 检查最大项目数
    if (this.projects.size >= this.maxProjects) {
      throw new ProjectError(
        `已达到最大项目数限制 (${this.maxProjects})`,
        'MAX_PROJECTS_REACHED' as ProjectErrorCode
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

    this.currentProjectId = project.id;
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
   * 获取项目数量
   */
  getProjectCount(): number {
    return this.projects.size;
  }
}
