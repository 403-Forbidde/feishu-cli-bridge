/**
 * FlushController 单元测试
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FlushController } from '../../src/platform/streaming/flush-controller';

describe('FlushController', () => {
  let flushFn: ReturnType<typeof vi.fn>;
  let controller: FlushController;

  beforeEach(() => {
    flushFn = vi.fn().mockResolvedValue(undefined);
    controller = new FlushController(flushFn);
  });

  describe('基本功能', () => {
    it('应该创建实例', () => {
      expect(controller).toBeDefined();
    });

    it('初始状态应该是空闲的', () => {
      const status = controller.getStatus();
      expect(status.isFlushing).toBe(false);
      expect(status.pendingFlush).toBe(false);
      expect(status.completed).toBe(false);
      expect(status.lastFlushTime).toBe(0);
    });
  });

  describe('节流控制', () => {
    it('应该延迟执行刷新', async () => {
      controller.throttledUpdate(50);

      // 立即检查 - 应该还没执行
      expect(flushFn).not.toHaveBeenCalled();

      // 等待节流时间
      await new Promise((r) => setTimeout(r, 60));

      expect(flushFn).toHaveBeenCalledTimes(1);
    });

    it('多次调用应该只执行一次刷新', async () => {
      // 快速多次调用
      controller.throttledUpdate(50);
      controller.throttledUpdate(50);
      controller.throttledUpdate(50);

      // 等待节流时间
      await new Promise((r) => setTimeout(r, 60));

      // 应该只执行一次
      expect(flushFn).toHaveBeenCalledTimes(1);
    });

    it('应该在节流间隔后执行新刷新', async () => {
      // 第一次调用
      controller.throttledUpdate(30);
      await new Promise((r) => setTimeout(r, 40));

      // 第二次调用
      controller.throttledUpdate(30);
      await new Promise((r) => setTimeout(r, 40));

      expect(flushFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('waitForFlush', () => {
    it('应该立即执行挂起的刷新', async () => {
      controller.throttledUpdate(1000); // 长延迟
      expect(flushFn).not.toHaveBeenCalled();

      await controller.waitForFlush();

      expect(flushFn).toHaveBeenCalledTimes(1);
    });

    it('应该等待当前刷新完成', async () => {
      let resolveFlush: () => void;
      const flushPromise = new Promise<void>((r) => {
        resolveFlush = r;
      });
      flushFn.mockReturnValue(flushPromise);

      // 开始刷新
      controller.throttledUpdate(10);
      await new Promise((r) => setTimeout(r, 20));

      // 刷新应该正在进行中
      expect(controller.getStatus().isFlushing).toBe(true);

      // 等待刷新完成
      const waitPromise = controller.waitForFlush();
      resolveFlush!();
      await waitPromise;

      expect(flushFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancelPendingFlush', () => {
    it('应该取消挂起的刷新', async () => {
      controller.throttledUpdate(50);
      controller.cancelPendingFlush();

      // 等待原本的执行时间
      await new Promise((r) => setTimeout(r, 60));

      expect(flushFn).not.toHaveBeenCalled();
    });
  });

  describe('complete', () => {
    it('应该标记为完成并取消挂起的刷新', async () => {
      controller.throttledUpdate(50);
      controller.complete();

      const status = controller.getStatus();
      expect(status.completed).toBe(true);
      expect(status.pendingFlush).toBe(false);

      // 等待原本的执行时间
      await new Promise((r) => setTimeout(r, 60));

      // 完成状态后不应执行刷新
      expect(flushFn).not.toHaveBeenCalled();
    });

    it('完成状态后调用 throttledUpdate 应该被忽略', async () => {
      controller.complete();
      await controller.throttledUpdate(50);

      await new Promise((r) => setTimeout(r, 60));

      expect(flushFn).not.toHaveBeenCalled();
    });
  });

  describe('长间隔检测', () => {
    it('长间隔后应该立即刷新', async () => {
      // 创建自定义阈值的控制器
      const customController = new FlushController(flushFn, 50);

      // 第一次刷新 - 触发节流然后等待
      customController.throttledUpdate(10);
      await new Promise((r) => setTimeout(r, 20));
      expect(flushFn).toHaveBeenCalledTimes(1);

      // 等待超过阈值
      await new Promise((r) => setTimeout(r, 60));

      // 再次调用应该立即刷新（不等待节流间隔）
      customController.throttledUpdate(1000);
      // 由于长间隔检测，应该立即执行
      await new Promise((r) => setTimeout(r, 5));

      expect(flushFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('错误处理', () => {
    it('刷新失败应该抛出错误', async () => {
      flushFn.mockRejectedValue(new Error('Flush failed'));

      // 先触发一次刷新
      controller.throttledUpdate(10);
      await new Promise((r) => setTimeout(r, 20));

      // 然后等待刷新完成，应该抛出错误
      await expect(controller.waitForFlush()).rejects.toThrow('Flush failed');
    });

    it('刷新失败后应该标记为需要重试', async () => {
      flushFn.mockRejectedValue(new Error('Flush failed'));

      // 先触发一次刷新
      controller.throttledUpdate(10);
      await new Promise((r) => setTimeout(r, 20));

      try {
        await controller.waitForFlush();
      } catch {
        // 忽略错误
      }

      // 失败后会标记 pendingFlush，但不会自动重试
      const status = controller.getStatus();
      expect(status.pendingFlush).toBe(true);
    });
  });

  describe('互斥锁', () => {
    it('应该防止并发刷新', async () => {
      let flushCount = 0;
      let resolveFirst: () => void;
      const firstPromise = new Promise<void>((r) => {
        resolveFirst = r;
      });

      flushFn.mockImplementation(() => {
        flushCount++;
        return firstPromise;
      });

      // 开始第一次刷新
      controller.throttledUpdate(10);
      await new Promise((r) => setTimeout(r, 20));

      expect(flushCount).toBe(1);
      expect(controller.getStatus().isFlushing).toBe(true);

      // 在第一次完成前尝试第二次
      controller.throttledUpdate(10);
      await new Promise((r) => setTimeout(r, 20));

      // 应该仍然只有一次刷新（被合并）
      expect(flushCount).toBe(1);

      // 完成第一次
      resolveFirst!();
      await new Promise((r) => setTimeout(r, 10));

      // 由于在刷新期间有新的请求，会链式执行第二次
      expect(flushCount).toBe(2);
    });

    it('刷新期间的多次请求应该合并为一次', async () => {
      let flushCount = 0;
      let resolveFirst: () => void;
      const firstPromise = new Promise<void>((r) => {
        resolveFirst = r;
      });

      flushFn.mockImplementation(() => {
        flushCount++;
        return firstPromise;
      });

      // 开始第一次刷新
      controller.throttledUpdate(10);
      await new Promise((r) => setTimeout(r, 20));

      // 在第一次完成前多次请求
      controller.throttledUpdate(10);
      controller.throttledUpdate(10);
      controller.throttledUpdate(10);
      await new Promise((r) => setTimeout(r, 20));

      // 应该仍然只有一次
      expect(flushCount).toBe(1);

      // 完成第一次
      resolveFirst!();
      await new Promise((r) => setTimeout(r, 10));

      // 多次请求合并为一次后续刷新
      expect(flushCount).toBe(2);
    });
  });
});
