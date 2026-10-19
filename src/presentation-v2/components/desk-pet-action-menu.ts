/**
 * 桌宠动作菜单与快捷动作共用的展示类型。
 * 单独成文件：`<script setup>` 不允许 ES 模块导出，类型必须放在模块里。
 */

/** 「检测当前配置」展开后的单行结果。 */
export interface DeskPetMenuConfigRow {
  label: string;
  value: string;
}

/** 菜单内联的二次确认卡片内容（不依赖 app shell 里的 dialog host）。 */
export interface DeskPetMenuConfirm {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
}
