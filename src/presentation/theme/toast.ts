// toast.ts — presentation 层通知入口（V1 调用方兼容壳）
// 通知不再交给宿主 toastr：统一转发到 shared/notice-hub，由浮动气泡呈现。
// 进行中的进度提示请改用 beginNoticeTask_ACU；本函数只处理一次性消息。

import { notify_ACU, type NoticeAction_ACU, type NoticeKind_ACU } from '../../shared/notice-hub';
import { ACU_PRODUCT_NAME_ACU } from '../../shared/product-brand';

export const ACU_TOAST_TITLE_ACU = ACU_PRODUCT_NAME_ACU;

const NOTICE_KINDS_ACU = new Set<NoticeKind_ACU>(['info', 'success', 'warning', 'error']);

function normalizeNoticeKind_ACU(type: unknown): NoticeKind_ACU {
  const kind = String(type || '').toLowerCase() as NoticeKind_ACU;
  return NOTICE_KINDS_ACU.has(kind) ? kind : 'info';
}

/**
 * 发布一次性通知。
 * 兼容旧签名 `(type, message, title?, options?)` 与 `(type, message, options?)`；
 * 旧 toastr 选项（timeOut、onShown 等）不再生效，可传 `acuActions` 附带结构化按钮。
 * @returns 恒为 null——不再有可供调用方操作的 toast 句柄
 */
export function showToastr_ACU(type: string, message: string, titleOrOptions: any = {}, maybeOptions: any = {}): null {
  let title = '';
  let options: any = {};
  if (typeof titleOrOptions === 'string') {
    title = titleOrOptions;
    options = (maybeOptions && typeof maybeOptions === 'object') ? maybeOptions : {};
  } else {
    options = (titleOrOptions && typeof titleOrOptions === 'object') ? titleOrOptions : {};
  }
  if (title === ACU_TOAST_TITLE_ACU) title = '';
  const actions: NoticeAction_ACU[] = Array.isArray(options.acuActions) ? options.acuActions : [];
  notify_ACU(normalizeNoticeKind_ACU(type), message, { title, actions });
  return null;
}
