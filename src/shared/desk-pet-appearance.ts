/**
 * 桌宠与通知气泡的外观设置：字段定义、类型与缺省值。
 *
 * 存在 settings_ACU.deskPetAppearance / settings_ACU.noticeBubbleAppearance，只存用户改过的项；
 * 桌宠位置沿用 settings_ACU.desktopPetPosition。缺省值与改造前写死在组件里的常量一致。
 */
import { resolveAppearance_ACU, type AppearanceField_ACU, type AppearanceSchema_ACU } from './appearance-schema';

export const DESK_PET_REACTIONS_ACU = ['shy', 'tickle', 'angry', 'happy', 'dizzy', 'surprised', 'wave', 'huff', 'pound', 'knockdown'] as const;
export const DESK_PET_POSES_ACU = [
  'idle', 'blink', 'look-left', 'look-right', 'walk-a', 'walk-b', 'roll', 'eat-a', 'eat-b', 'yawn',
  'snore', 'sit-snore', 'working', 'struggle', ...DESK_PET_REACTIONS_ACU,
] as const;
export const DESK_PET_PEEK_IMAGES_ACU = ['peek', 'peek-original', 'peek-sleepy'] as const;
export const DESK_PET_IMAGE_KEYS_ACU = [...DESK_PET_POSES_ACU, ...DESK_PET_PEEK_IMAGES_ACU] as const;
export const DESK_PET_IDLE_ACTIONS_ACU = ['blink', 'doubleBlink', 'lookAround', 'walk', 'roll', 'eat', 'yawn', 'glance'] as const;
export const DESK_PET_STATUS_GROUPS_ACU = ['table', 'plan', 'polish', 'continuation', 'simulation', 'import', 'index', 'skill', 'generic'] as const;
export const DESK_PET_DOCK_EDGES_ACU = ['left', 'right', 'top', 'bottom'] as const;
export const NOTICE_BUBBLE_SIDES_ACU = ['above', 'below', 'left', 'right'] as const;
export const NOTICE_BUBBLE_DOCK_CORNERS_ACU = ['top-right', 'top-left', 'bottom-right', 'bottom-left'] as const;

export type DeskPetReaction_ACU = typeof DESK_PET_REACTIONS_ACU[number];
export type DeskPetPose_ACU = typeof DESK_PET_POSES_ACU[number];
export type DeskPetPeekImage_ACU = typeof DESK_PET_PEEK_IMAGES_ACU[number];
export type DeskPetImageKey_ACU = typeof DESK_PET_IMAGE_KEYS_ACU[number];
export type DeskPetIdleAction_ACU = typeof DESK_PET_IDLE_ACTIONS_ACU[number];
export type DeskPetStatusGroup_ACU = typeof DESK_PET_STATUS_GROUPS_ACU[number];
export type DeskPetDockEdge_ACU = typeof DESK_PET_DOCK_EDGES_ACU[number];
export type NoticeBubbleSide_ACU = typeof NOTICE_BUBBLE_SIDES_ACU[number];
export type NoticeBubbleDockCorner_ACU = typeof NOTICE_BUBBLE_DOCK_CORNERS_ACU[number];
/** append：追加到内置文案之后；replace：只用自定义文案（自定义为空时仍用内置）。 */
export type AppearanceTextMode_ACU = 'append' | 'replace';

export interface DeskPetAppearance_ACU {
  /** null 表示使用内置图。 */
  images: Record<DeskPetImageKey_ACU, string | null>;
  size: { wide: number; narrow: number; peekDepthRatio: number; peekOriginalDepthRatio: number };
  motion: {
    enabled: boolean;
    idleActionMinMs: number;
    idleActionSpreadMs: number;
    idleActionWeights: Record<DeskPetIdleAction_ACU, number>;
    /** 0 表示不睡。 */
    snoreAfterMs: number;
    /** 0 表示不自动缩进。 */
    tuckDelayMs: number;
    peekRotateMs: number;
    peekOriginalChance: number;
    waveCooldownMs: number;
    reactionMs: Record<DeskPetReaction_ACU, number>;
  };
  jokes: { mode: AppearanceTextMode_ACU; heading: string; items: string[] };
  statusWords: { mode: AppearanceTextMode_ACU; groups: Record<DeskPetStatusGroup_ACU, string[]> };
}

export interface NoticeBubbleAppearance_ACU {
  colors: {
    background: string;
    text: string;
    muted: string;
    border: string;
    info: string;
    success: string;
    warning: string;
    error: string;
    joke: string;
    jokeBackground: string;
    jokeHeading: string;
    danger: string;
    dangerText: string;
  };
  fontSize: number;
  fontFamily: string;
  borderRadius: number;
  size: { minWidth: number; maxWidth: number; dockedMaxWidth: number; detailMaxHeight: number };
  anchor: { gap: number; sides: NoticeBubbleSide_ACU[] };
  dock: { corner: NoticeBubbleDockCorner_ACU; offsetX: number; offsetY: number; narrowOffsetY: number };
  /** slidesPerJoke 为 0 表示不在消息间插播语录；idleJokeMs 为 0 表示空闲时不讲。 */
  carousel: { slideMs: number; slidesPerJoke: number; idleJokeMs: number };
}

/** 桌宠位置按视口可用范围的比例保存（0~1）；edge 为吸附的侧边，null 表示自由停放。 */
export interface DeskPetPosition_ACU {
  x: number;
  y: number;
  edge: DeskPetDockEdge_ACU | null;
}

/** 设置整份随每次保存写盘，图片数据过大会拖慢所有保存。 */
export const DESK_PET_IMAGE_MAX_LENGTH_ACU = 1024 * 1024;
export const DESK_PET_IMAGES_TOTAL_MAX_LENGTH_ACU = 4 * 1024 * 1024;

const IMAGE_LABELS_ACU: Record<DeskPetImageKey_ACU, string> = {
  idle: '待机',
  blink: '眨眼',
  'look-left': '向左看',
  'look-right': '向右看',
  'walk-a': '散步（第 1 帧）',
  'walk-b': '散步（第 2 帧）',
  roll: '打滚',
  'eat-a': '偷吃零食（第 1 帧）',
  'eat-b': '偷吃零食（第 2 帧）',
  yawn: '打哈欠',
  snore: '打呼噜',
  'sit-snore': '坐地上打呼噜',
  working: '干活中',
  struggle: '被拎起来挣扎',
  shy: '害羞（点一下）',
  tickle: '怕痒（连点三下）',
  angry: '生气（戳太多）',
  happy: '被摸得很舒服（长按）',
  dizzy: '被晃晕',
  surprised: '睡着时被点醒吓一跳',
  wave: '鼠标靠近打招呼',
  huff: '气得直哈气',
  pound: '锤屏幕',
  knockdown: '把自己震倒',
  peek: '贴边探头（底边平切、头朝上，按停靠边自动旋转）',
  'peek-original': '贴边探头 · 稀有造型',
  'peek-sleepy': '贴边探头 · 睡着时',
};

const IDLE_ACTION_DEFAULTS_ACU: Record<DeskPetIdleAction_ACU, [label: string, weight: number]> = {
  blink: ['眨眼', 16],
  doubleBlink: ['连眨两下', 8],
  lookAround: ['左右张望', 14],
  walk: ['散步', 18],
  roll: ['打滚', 10],
  eat: ['偷吃零食', 14],
  yawn: ['打哈欠', 10],
  glance: ['看向一侧', 10],
};

const REACTION_DEFAULTS_ACU: Record<DeskPetReaction_ACU, [label: string, ms: number]> = {
  shy: ['害羞', 1600],
  tickle: ['怕痒', 1600],
  angry: ['生气', 2200],
  happy: ['被摸舒服（松手后的余韵另计）', 1100],
  dizzy: ['晕', 2400],
  surprised: ['吓一跳', 1300],
  wave: ['打招呼', 1600],
  huff: ['哈气', 1000],
  pound: ['锤屏幕', 1300],
  knockdown: ['震倒', 2200],
};

const STATUS_GROUP_LABELS_ACU: Record<DeskPetStatusGroup_ACU, string> = {
  table: '填表 / 追平',
  plan: '剧情规划',
  polish: '正文优化',
  continuation: '智能续写',
  simulation: '格林推演',
  import: '外部导入',
  index: '交火 / 索引 / 召回',
  skill: 'Skill 整理',
  generic: '其他任务',
};

const DEFAULT_FONT_FAMILY_ACU = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
const FONT_FAMILY_RE_ACU = /^[\p{L}\p{N}\s,'"._-]+$/u;

function fieldsFrom_ACU<K extends string>(keys: readonly K[], make: (key: K) => AppearanceField_ACU): AppearanceSchema_ACU {
  return Object.fromEntries(keys.map(key => [key, make(key)]));
}

const integer_ACU = (label: string, value: number, min: number, max: number, zeroAllowed = false): AppearanceField_ACU =>
  ({ kind: 'number', label, default: value, min, max, integer: true, ...(zeroAllowed ? { zeroAllowed: true } : {}) });

const ratio_ACU = (label: string, value: number, min: number, max: number): AppearanceField_ACU =>
  ({ kind: 'number', label, default: value, min, max });

const color_ACU = (label: string, value: string): AppearanceField_ACU => ({ kind: 'color', label, default: value });

const textMode_ACU = (label: string): AppearanceField_ACU =>
  ({ kind: 'enum', label, default: 'append', values: ['append', 'replace'] });

export const DESK_PET_APPEARANCE_SCHEMA_ACU: AppearanceSchema_ACU = {
  images: {
    kind: 'group',
    label: '动作图片：http(s) 链接、站内路径或 data:image，null 为内置图',
    fields: fieldsFrom_ACU(DESK_PET_IMAGE_KEYS_ACU, key => ({ kind: 'image', label: IMAGE_LABELS_ACU[key], maxLength: DESK_PET_IMAGE_MAX_LENGTH_ACU })),
  },
  size: {
    kind: 'group',
    label: '尺寸',
    fields: {
      wide: integer_ACU('宽屏尺寸（px）', 88, 32, 256),
      narrow: integer_ACU('窄屏尺寸（px，视口宽 ≤640px）', 64, 32, 256),
      peekDepthRatio: ratio_ACU('贴边缩进时露出部分占尺寸的比例', 0.56, 0.2, 1),
      peekOriginalDepthRatio: ratio_ACU('稀有探头造型露出部分占尺寸的比例', 0.61, 0.2, 1),
    },
  },
  motion: {
    kind: 'group',
    label: '动画与节奏',
    fields: {
      enabled: { kind: 'boolean', label: '动效开关：关闭后不播呼吸、摇摆等动效，也不散步打滚（动作帧照常切换）', default: true },
      idleActionMinMs: integer_ACU('待机小动作的最短间隔（毫秒）', 15000, 1000, 3600000),
      idleActionSpreadMs: integer_ACU('待机小动作间隔的随机浮动（毫秒）', 5000, 0, 3600000),
      idleActionWeights: {
        kind: 'group',
        label: '待机小动作的抽取权重（0 表示不做）',
        fields: fieldsFrom_ACU(DESK_PET_IDLE_ACTIONS_ACU, key => ratio_ACU(IDLE_ACTION_DEFAULTS_ACU[key][0], IDLE_ACTION_DEFAULTS_ACU[key][1], 0, 1000)),
      },
      snoreAfterMs: integer_ACU('无互动多久睡着（毫秒，0 表示不睡）', 60000, 5000, 86400000, true),
      tuckDelayMs: integer_ACU('吸附到屏幕边后多久缩进去（毫秒，0 表示不自动缩进）', 4000, 500, 3600000, true),
      peekRotateMs: integer_ACU('缩进期间重抽探头造型的间隔（毫秒）', 30000, 1000, 3600000),
      peekOriginalChance: ratio_ACU('缩进时抽到稀有探头造型的概率', 0.01, 0, 1),
      waveCooldownMs: integer_ACU('鼠标靠近打招呼的冷却（毫秒）', 30000, 0, 86400000),
      reactionMs: {
        kind: 'group',
        label: '互动反应的持续时长（毫秒）',
        fields: fieldsFrom_ACU(DESK_PET_REACTIONS_ACU, key => integer_ACU(REACTION_DEFAULTS_ACU[key][0], REACTION_DEFAULTS_ACU[key][1], 200, 20000)),
      },
    },
  },
  jokes: {
    kind: 'group',
    label: '语录（气泡插播的冷笑话）',
    fields: {
      mode: textMode_ACU('append 追加到内置语录之后；replace 只用自定义语录（自定义为空时仍用内置）'),
      heading: { kind: 'text', label: '语录气泡的标题（可留空）', default: '你知道吗？', maxLength: 40, allowEmpty: true },
      items: { kind: 'textList', label: '自定义语录', maxItems: 2000, maxLength: 600 },
    },
  },
  statusWords: {
    kind: 'group',
    label: '忙碌状态词（气泡显示「正在XX…」）',
    fields: {
      mode: textMode_ACU('append 追加到内置状态词之后；replace 只用自定义状态词（某组为空时该组仍用内置）'),
      groups: {
        kind: 'group',
        label: '按功能分组的自定义状态词',
        fields: fieldsFrom_ACU(DESK_PET_STATUS_GROUPS_ACU, key => ({ kind: 'textList', label: STATUS_GROUP_LABELS_ACU[key], maxItems: 200, maxLength: 20 })),
      },
    },
  },
};

export const NOTICE_BUBBLE_APPEARANCE_SCHEMA_ACU: AppearanceSchema_ACU = {
  colors: {
    kind: 'group',
    label: '配色',
    fields: {
      background: color_ACU('底色', '#fffaf0'),
      text: color_ACU('正文文字', '#3d3122'),
      muted: color_ACU('次要文字（明细标题、关闭按钮）', '#7a6a52'),
      border: color_ACU('边框与分隔线', '#e9cf8a'),
      info: color_ACU('普通提示的强调色（标题、按钮边框）', '#d4a93a'),
      success: color_ACU('成功提示的强调色', '#6f9a4d'),
      warning: color_ACU('警告提示的强调色', '#d08a2c'),
      error: color_ACU('错误提示的强调色', '#c2503a'),
      joke: color_ACU('语录的强调色', '#e6b93c'),
      jokeBackground: color_ACU('语录的底色', '#fff6d8'),
      jokeHeading: color_ACU('语录标题文字', '#a47a12'),
      danger: color_ACU('危险按钮（如「停止」）的边框与悬停底色', '#c2503a'),
      dangerText: color_ACU('危险按钮文字', '#a33d29'),
    },
  },
  fontSize: integer_ACU('正文字号（px），标题与按钮随之缩放', 12, 10, 24),
  fontFamily: {
    kind: 'text',
    label: '字体（CSS font-family）',
    default: DEFAULT_FONT_FAMILY_ACU,
    maxLength: 300,
    pattern: FONT_FAMILY_RE_ACU,
    patternHint: '只能包含文字、数字、空格、逗号、引号、点、下划线和连字符',
  },
  borderRadius: integer_ACU('圆角（px）', 12, 0, 32),
  size: {
    kind: 'group',
    label: '尺寸',
    fields: {
      minWidth: integer_ACU('最小宽度（px）', 200, 80, 600),
      maxWidth: integer_ACU('贴着桌宠时的最大宽度（px）', 400, 120, 960),
      dockedMaxWidth: integer_ACU('没有桌宠、停靠屏幕角落时的最大宽度（px）', 360, 120, 960),
      detailMaxHeight: integer_ACU('展开明细区的最大高度（px）', 160, 40, 800),
    },
  },
  anchor: {
    kind: 'group',
    label: '贴着桌宠时的摆放',
    fields: {
      gap: integer_ACU('与桌宠的间距（px）', 12, 0, 96),
      sides: {
        kind: 'enumList',
        label: '摆放方位的优先顺序，放不下依次尝试；都放不下时用最后一个并夹进屏幕',
        default: ['above', 'below', 'left', 'right'],
        values: NOTICE_BUBBLE_SIDES_ACU,
        minItems: 1,
      },
    },
  },
  dock: {
    kind: 'group',
    label: '没有桌宠时的停靠',
    fields: {
      corner: { kind: 'enum', label: '停靠的屏幕角落', default: 'top-right', values: NOTICE_BUBBLE_DOCK_CORNERS_ACU },
      offsetX: integer_ACU('距左右边缘（px）', 18, 0, 400),
      offsetY: integer_ACU('距上下边缘（px）', 62, 0, 400),
      narrowOffsetY: integer_ACU('窄屏（视口宽 ≤640px）距上下边缘（px），窄屏时水平居中', 58, 0, 400),
    },
  },
  carousel: {
    kind: 'group',
    label: '轮播节奏',
    fields: {
      slideMs: integer_ACU('每条停留时长（毫秒）', 5000, 1000, 120000),
      slidesPerJoke: integer_ACU('每播几条消息插一条语录（0 表示不插播）', 2, 1, 50, true),
      idleJokeMs: integer_ACU('空闲多久讲一条语录（毫秒，0 表示空闲时不讲）', 300000, 10000, 86400000, true),
    },
  },
};

export function defaultDeskPetAppearance_ACU(): DeskPetAppearance_ACU {
  return resolveAppearance_ACU(DESK_PET_APPEARANCE_SCHEMA_ACU, {}) as unknown as DeskPetAppearance_ACU;
}

export function defaultNoticeBubbleAppearance_ACU(): NoticeBubbleAppearance_ACU {
  return resolveAppearance_ACU(NOTICE_BUBBLE_APPEARANCE_SCHEMA_ACU, {}) as unknown as NoticeBubbleAppearance_ACU;
}

/** 写入前的跨字段检查：自定义图片总量。 */
export function checkDeskPetAppearance_ACU(appearance: DeskPetAppearance_ACU): void {
  const total = Object.values(appearance.images).reduce((sum, src) => sum + (src ? src.length : 0), 0);
  if (total > DESK_PET_IMAGES_TOTAL_MAX_LENGTH_ACU) {
    throw new RangeError(`deskPet.images：自定义图片合计 ${total} 字符，超过上限 ${DESK_PET_IMAGES_TOTAL_MAX_LENGTH_ACU}；大图请改用图片链接`);
  }
}

/** 写入前的跨字段检查：最小宽度不能超过两种最大宽度。 */
export function checkNoticeBubbleAppearance_ACU(appearance: NoticeBubbleAppearance_ACU): void {
  const { minWidth, maxWidth, dockedMaxWidth } = appearance.size;
  if (minWidth > maxWidth || minWidth > dockedMaxWidth) {
    throw new RangeError(`noticeBubble.size：minWidth（${minWidth}）不能大于 maxWidth（${maxWidth}）或 dockedMaxWidth（${dockedMaxWidth}）`);
  }
}

export function normalizeDeskPetDockEdge_ACU(value: unknown): DeskPetDockEdge_ACU | null {
  return (DESK_PET_DOCK_EDGES_ACU as readonly unknown[]).includes(value) ? value as DeskPetDockEdge_ACU : null;
}
