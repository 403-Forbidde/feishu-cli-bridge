/**
 * Interactive cards builder
 * 交互式卡片构建模块
 *
 * 包含交互式工具卡片：
 * - 模式选择卡片
 * - 模型选择卡片
 * - 帮助卡片
 * - 重置成功卡片
 * - 测试卡片 v2 系列
 */

import type { CardElement, FeishuCard } from './base.js';

/** Agent 信息 */
export interface AgentInfo {
  name: string;
  displayName?: string;
  description?: string;
}

/** 模型信息 */
export interface ModelInfo {
  fullId: string;
  name?: string;
  provider?: string;
  model?: string;
}

/**
 * 构建 agent 模式切换卡片（Schema 2.0 格式）
 *
 * 当前 agent 用绿色 primary 按钮标识，其余为 default 按钮。
 * 点击后推送 im.card.action.trigger_v1，handler 处理 switch_mode 动作。
 *
 * @param agents - 用户可见的 agent 列表，每项含 name / description
 * @param currentAgent - 当前激活的 agent 名称
 * @param cliType - CLI 工具类型（写入按钮 value，供 handler 路由）
 */
export function buildModeSelectCard(
  agents: AgentInfo[],
  currentAgent: string,
  cliType: string = 'opencode'
): FeishuCard {
  const elements: CardElement[] = [];

  const getLabel = (a: AgentInfo): string => a.displayName || a.name;

  const currentInfo = agents.find((a) => a.name === currentAgent);
  const currentLabel = currentInfo ? getLabel(currentInfo) : currentAgent;
  const currentDesc = currentInfo?.description || '';

  // ── 当前激活区块（绿色高亮，无切换按钮）─────────────────────────────
  elements.push({
    tag: 'markdown',
    content: "<font color='grey'>当前激活</font>",
  });
  elements.push({
    tag: 'markdown',
    content: `<font color='green'>🟢 **${currentLabel}**</font>\n${currentDesc}`,
  });
  elements.push({ tag: 'hr' });

  // ── 其余 agent：名称 + 描述 + 醒目蓝色切换按钮 ───────────────────────
  for (const agent of agents) {
    const name = agent.name;
    const label = getLabel(agent);
    const desc = agent.description || '';
    if (name === currentAgent) {
      continue;
    }

    elements.push({
      tag: 'markdown',
      content: `**${label}**\n<font color='grey'>${desc}</font>`,
    });
    elements.push({
      tag: 'button',
      text: { tag: 'plain_text', content: '▶ 切换至此' },
      type: 'primary',
      value: {
        action: 'switch_mode',
        agent_id: name,
        cli_type: cliType,
      },
    });
  }

  return {
    schema: '2.0',
    config: { wide_screen_mode: true, update_multi: true },
    header: {
      title: { tag: 'plain_text', content: '🔄 切换 Agent 模式' },
      template: 'blue',
    },
    body: { elements },
  };
}

/**
 * 构建模型切换卡片（与 Agent 模式卡片风格一致）
 *
 * 当前模型用绿色高亮标识，其余模型显示名称 + ID + 切换按钮。
 * 底部附 config.yaml 模型列表管理说明。
 *
 * @param models - 可用模型列表，每项含 provider / model / name / full_id
 * @param currentModel - 当前激活的模型 full_id（如 kimi-for-coding/k2p5）
 * @param cliType - CLI 工具类型（写入按钮 value，供 handler 路由）
 */
export function buildModelSelectCard(
  models: ModelInfo[],
  currentModel: string,
  cliType: string = 'opencode'
): FeishuCard {
  const elements: CardElement[] = [];

  const currentInfo = models.find((m) => m.fullId === currentModel);
  const currentName = currentInfo?.name || currentModel;

  // ── 当前激活模型（绿色高亮，无切换按钮）──────────────────────────────
  elements.push({
    tag: 'markdown',
    content: "<font color='grey'>当前激活</font>",
  });
  elements.push({
    tag: 'markdown',
    content: `<font color='green'>🟢 **${currentName}**</font>\n<font color='grey'>\`${currentModel}\`</font>`,
  });
  elements.push({ tag: 'hr' });

  // ── 其余模型：名称 + ID + 切换按钮 ──────────────────────────────────
  for (const model of models) {
    const fullId = model.fullId;
    if (fullId === currentModel) {
      continue;
    }

    const name = model.name || fullId;
    elements.push({
      tag: 'markdown',
      content: `**${name}**\n<font color='grey'>\`${fullId}\`</font>`,
    });
    elements.push({
      tag: 'button',
      text: { tag: 'plain_text', content: '▶ 切换至此' },
      type: 'primary',
      value: {
        action: 'switch_model',
        model_id: fullId,
        cli_type: cliType,
      },
    });
  }

  // ── 底部：模型列表管理说明 ────────────────────────────────────────────
  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'markdown',
    content: "💡 <font color='grey'>在 `config.yaml` 中管理模型列表，格式参考 `config.example.yaml`</font>",
  });

  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '🤖 切换模型' },
      template: 'turquoise',
    },
    body: { elements },
  };
}

/**
 * 构建 TUI 命令帮助卡片（Schema 2.0 格式）- 优化版
 *
 * 采用颜色编码+图标系统，使命令作用一目了然：
 * - 🟢 绿色 = 创建类操作（/new）
 * - 🔵 蓝色 = 管理类操作（/session）
 * - 🟣 紫色 = 配置类操作（/model）
 * - 🟠 橙色 = 模式切换（/mode）
 * - 🔴 红色 = 重置/停止（/reset, /stop）
 * - ⚪ 灰色 = 信息类（/help）
 *
 * @param cliType - CLI 工具类型（如 opencode）
 * @param workingDir - 当前工作目录
 * @param projectName - 当前项目名称
 */
export function buildHelpCard(
  cliType: string = 'opencode',
  workingDir: string = '',
  projectName?: string
): FeishuCard {
  const elements: CardElement[] = [];

  // ── 头部信息区 ─────────────────────────────────────────────────────────
  const headerParts: string[] = [`🤖 **${cliType.toUpperCase()}** 智能助手`];
  if (projectName) {
    headerParts.push(`📁 **当前项目**：\`${projectName}\``);
  }
  if (workingDir) {
    headerParts.push(`<font color='grey'>💼 工作目录：\`${workingDir}\`</font>`);
  }

  elements.push({
    tag: 'markdown',
    content: headerParts.join('\n'),
  });
  elements.push({ tag: 'hr' });

  // ── 命令列表（颜色编码+图标系统）─────────────────────────────────────────
  const commands = [
    {
      cmd: '/new',
      icon: '🆕',
      color: 'green',
      desc: '新建会话',
      detail: '创建全新的对话上下文，开始独立话题讨论',
    },
    {
      cmd: '/session',
      icon: '📋',
      color: 'blue',
      desc: '会话管理',
      detail: '查看、切换和管理所有历史会话记录',
    },
    {
      cmd: '/model',
      icon: '🧠',
      color: 'purple',
      desc: '切换模型',
      detail: '在配置的 AI 模型列表中选择使用',
    },
    {
      cmd: '/mode',
      icon: '🎯',
      color: 'orange',
      desc: '工作模式',
      detail: '切换 Agent 角色（编码、审查、调试等）',
    },
    {
      cmd: '/reset',
      icon: '🔄',
      color: 'red',
      desc: '清空对话',
      detail: '重置当前会话，清除所有历史消息',
    },
    {
      cmd: '/stop',
      icon: '🛑',
      color: 'red',
      desc: '停止生成',
      detail: '立即中断 AI 正在进行的回复生成',
    },
    {
      cmd: '/help',
      icon: '❓',
      color: 'grey',
      desc: '使用帮助',
      detail: '显示所有可用命令的详细说明',
    },
  ];

  for (const item of commands) {
    const { color, cmd, icon, desc, detail } = item;

    // 使用 column_set 实现左右布局：左侧命令，右侧描述
    elements.push({
      tag: 'column_set',
      flex_mode: 'none',
      columns: [
        {
          tag: 'column',
          width: 'auto',
          elements: [
            {
              tag: 'markdown',
              content: `<font color='${color}'>${icon} **\`${cmd}\`**</font>`,
            },
          ],
        },
        {
          tag: 'column',
          width: 'weighted',
          weight: 3,
          elements: [
            {
              tag: 'markdown',
              content: `**${desc}**\n<font color='grey'>${detail}</font>`,
            },
          ],
        },
      ],
    });
    elements.push({ tag: 'hr' });
  }

  // ── 快速提示区 ─────────────────────────────────────────────────────────
  elements.push({ tag: 'hr' });
  elements.push({
    tag: 'markdown',
    content:
      '💡 **使用提示**\n' +
      '• 所有命令以 `/` 开头，支持随时发送\n' +
      '• 流式输出期间也可执行命令\n' +
      '• `/stop` 可立即中断正在生成的回复',
  });

  return {
    schema: '2.0',
    config: {
      wide_screen_mode: true,
      update_multi: true,
    },
    header: {
      title: { tag: 'plain_text', content: '📖 命令帮助' },
      template: 'blue',
    },
    body: { elements },
  };
}

/**
 * 构建重置成功提示卡片（Schema 2.0 格式）
 *
 * @returns 飞书卡片 JSON（Schema 2.0）
 */
export function buildResetSuccessCard(): FeishuCard {
  const elements: CardElement[] = [
    {
      tag: 'markdown',
      content: '🗑️ 对话历史已清空',
    },
    {
      tag: 'markdown',
      content: '💡 可以开始新的对话了',
    },
  ];

  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '✅ 已重置当前会话' },
      template: 'green',
    },
    body: { elements },
  };
}

/**
 * 构建 Schema 2.0 测试卡片 - 初始状态
 *
 * 展示 Schema 2.0 的现代化布局和交互按钮。
 */
export function buildTestCardV2Initial(): FeishuCard {
  const currentTime = new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '🧪 Schema 2.0 交互测试' },
      template: 'blue',
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: "<font color='grey'>💡 点击下方按钮测试卡片更新功能</font>",
        },
        { tag: 'hr' },
        {
          tag: 'column_set',
          flex_mode: 'none',
          columns: [
            {
              tag: 'column',
              width: 'auto',
              elements: [
                {
                  tag: 'markdown',
                  content: "<font color='grey'>当前状态</font>",
                },
              ],
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 3,
              elements: [
                {
                  tag: 'markdown',
                  content: '🟢 **初始状态**',
                },
              ],
            },
          ],
        },
        {
          tag: 'column_set',
          flex_mode: 'none',
          columns: [
            {
              tag: 'column',
              width: 'auto',
              elements: [
                {
                  tag: 'markdown',
                  content: "<font color='grey'>创建时间</font>",
                },
              ],
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 3,
              elements: [
                {
                  tag: 'markdown',
                  content: `\`${currentTime}\``,
                },
              ],
            },
          ],
        },
        { tag: 'hr' },
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '📊 显示详情' },
          type: 'primary',
          value: {
            action: 'test_card_action',
            sub_action: 'show_details',
          },
        },
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '📈 数据展示' },
          type: 'default',
          value: {
            action: 'test_card_action',
            sub_action: 'show_data',
          },
        },
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '❌ 结束测试' },
          type: 'danger',
          value: {
            action: 'test_card_action',
            sub_action: 'close_test',
          },
        },
      ],
    },
  };
}

/**
 * 构建 Schema 2.0 测试卡片 - 详情状态
 *
 * 展示可折叠面板（Schema 2.0 独有特性）。
 */
export function buildTestCardV2Details(): FeishuCard {
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '🧪 Schema 2.0 交互测试' },
      template: 'green',
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: "<font color='green'>✅ 已切换到详情视图</font>",
        },
        { tag: 'hr' },
        {
          tag: 'column_set',
          flex_mode: 'none',
          columns: [
            {
              tag: 'column',
              width: 'auto',
              elements: [
                {
                  tag: 'markdown',
                  content: "<font color='grey'>当前状态</font>",
                },
              ],
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 3,
              elements: [
                {
                  tag: 'markdown',
                  content: '🔵 **详情展示**',
                },
              ],
            },
          ],
        },
        {
          tag: 'collapsible_panel',
          expanded: true,
          header: {
            title: {
              tag: 'markdown',
              content: '📋 Schema 2.0 特性说明',
            },
            icon: {
              tag: 'standard_icon',
              token: 'down-small-ccm_outlined',
              size: '16px 16px',
            },
            icon_position: 'follow_text',
            icon_expanded_angle: -180,
          },
          border: { color: 'blue', corner_radius: '6px' },
          padding: '12px',
          elements: [
            {
              tag: 'markdown',
              content:
                '**Schema 2.0 优势：**\n' +
                '• 🎨 **现代化布局** - column_set 两列排版\n' +
                '• 📦 **可折叠面板** - collapsible_panel 交互\n' +
                '• 🎯 **彩色标签** - header template 主题色\n' +
                '• ⚡ **流畅更新** - CardKit API 实时刷新',
            },
          ],
        },
        { tag: 'hr' },
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '📈 数据展示' },
          type: 'default',
          value: {
            action: 'test_card_action',
            sub_action: 'show_data',
          },
        },
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '❌ 结束测试' },
          type: 'danger',
          value: {
            action: 'test_card_action',
            sub_action: 'close_test',
          },
        },
      ],
    },
  };
}

/**
 * 构建 Schema 2.0 测试卡片 - 数据展示状态
 *
 * 展示两列数据布局。
 */
export function buildTestCardV2Data(): FeishuCard {
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '🧪 Schema 2.0 交互测试' },
      template: 'turquoise',
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content: "<font color='turquoise'>📊 已切换到数据视图</font>",
        },
        { tag: 'hr' },
        {
          tag: 'markdown',
          content: '**性能指标**',
        },
        {
          tag: 'column_set',
          flex_mode: 'none',
          columns: [
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'markdown',
                  content: "<font color='grey'>卡片渲染</font>\n**<font color='green'>12ms</font>**",
                },
              ],
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'markdown',
                  content: "<font color='grey'>API 延迟</font>\n**<font color='green'>85ms</font>**",
                },
              ],
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              elements: [
                {
                  tag: 'markdown',
                  content: "<font color='grey'>更新速度</font>\n**<font color='green'>100ms</font>**",
                },
              ],
            },
          ],
        },
        { tag: 'hr' },
        {
          tag: 'column_set',
          flex_mode: 'none',
          columns: [
            {
              tag: 'column',
              width: 'auto',
              elements: [
                {
                  tag: 'markdown',
                  content: "<font color='grey'>当前状态</font>",
                },
              ],
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 3,
              elements: [
                {
                  tag: 'markdown',
                  content: '🟣 **数据展示**',
                },
              ],
            },
          ],
        },
        { tag: 'hr' },
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '📊 显示详情' },
          type: 'default',
          value: {
            action: 'test_card_action',
            sub_action: 'show_details',
          },
        },
        {
          tag: 'button',
          text: { tag: 'plain_text', content: '❌ 结束测试' },
          type: 'danger',
          value: {
            action: 'test_card_action',
            sub_action: 'close_test',
          },
        },
      ],
    },
  };
}

/**
 * 构建 Schema 2.0 测试卡片 - 结束状态
 *
 * 测试完成后的最终状态。
 */
export function buildTestCardV2Closed(): FeishuCard {
  return {
    schema: '2.0',
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: '🧪 Schema 2.0 交互测试' },
      template: 'grey',
    },
    body: {
      elements: [
        {
          tag: 'markdown',
          content:
            "<font color='grey'>✅ **测试已完成**</font>\n\n" +
            '感谢体验 Schema 2.0 交互卡片！\n\n' +
            '**测试总结：**\n' +
            '• 卡片创建成功 ✅\n' +
            '• 按钮交互正常 ✅\n' +
            '• 动态更新流畅 ✅\n' +
            '• Schema 2.0 特性完整 ✅',
        },
        { tag: 'hr' },
        {
          tag: 'markdown',
          content: "<font color='grey'>再次测试请发送 `/testcard2`</font>",
          text_size: 'notation',
        },
      ],
    },
  };
}
