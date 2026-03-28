/**
 * 项目管理类型定义
 * Project Management Type Definitions
 *
 * 定义项目、项目配置等相关类型
 */

/**
 * 项目信息
 */
export interface Project {
  /** 项目唯一标识 */
  id: string;

  /** 项目名称（用于命令引用） */
  name: string;

  /** 显示名称 */
  displayName: string;

  /** 项目路径 */
  path: string;

  /** 创建时间戳 */
  createdAt: number;

  /** 更新时间戳 */
  updatedAt: number;
}

/**
 * 项目配置
 */
export interface ProjectConfig {
  /** 存储路径 */
  storagePath: string;

  /** 最大项目数 */
  maxProjects: number;

  /** 允许的项目根目录（安全限制） */
  allowedRoot?: string;
}

/**
 * 项目存储数据结构
 */
export interface ProjectStorage {
  /** 项目列表 */
  projects: Project[];

  /** 当前激活的项目 ID */
  currentProjectId: string | null;

  /** 存储版本 */
  version: number;
}

/**
 * 项目错误类型
 */
export enum ProjectErrorCode {
  PATH_TRAVERSAL = 'PATH_TRAVERSAL',
  PATH_NOT_EXIST = 'PATH_NOT_EXIST',
  PATH_NOT_DIRECTORY = 'PATH_NOT_DIRECTORY',
  PROJECT_EXISTS = 'PROJECT_EXISTS',
  PROJECT_NOT_FOUND = 'PROJECT_NOT_FOUND',
  STORAGE_ERROR = 'STORAGE_ERROR',
  MAX_PROJECTS_REACHED = 'MAX_PROJECTS_REACHED',
}

/**
 * 项目错误
 */
export class ProjectError extends Error {
  constructor(
    message: string,
    public readonly code: ProjectErrorCode,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ProjectError';
  }
}
