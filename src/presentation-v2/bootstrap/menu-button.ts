/**
 * menu-button — 在 host document 的 #extensionsMenu 中挂 UI v2 按钮（D15）
 *
 * 与旧菜单按钮（startup.ts 中的旧 UI 入口）共存，互不影响。
 * 依赖 host document 解析（D15.1），因此也只在 host document 上注册按钮。
 */
import { logDebug_ACU, logError_ACU } from '../../shared/utils';
import { ACU_PRODUCT_DISPLAY_NAME_ACU } from '../../shared/product-brand';
import { getAcuHostDocument, getAcuHostWindow, getAcuHostSource } from './host-document';
import { openAcuV2App } from './mount';

const MENU_CONTAINER_ID = 'acu-v2-menu-container';
const MENU_ITEM_ID = 'acu-v2-menu-item';
const CLICK_NS = 'click.acu-v2';

/** 等待 host document 中出现 #extensionsMenu 后注入按钮；找不到时轮询。 */
export function registerAcuV2MenuButton(): void {
  attemptInsert(0);
}

function attemptInsert(retry: number): void {
  const doc = getAcuHostDocument();
  const $ = getHostJQuery();
  if (!doc || !$) {
    if (retry < 10) {
      setTimeout(() => attemptInsert(retry + 1), 1000);
    } else {
      logError_ACU('[ACU-V2] menu button registration aborted: host doc/jQuery not ready after 10 retries.');
    }
    return;
  }
  const extensionsMenu = $('#extensionsMenu', doc);
  if (!extensionsMenu.length) {
    if (retry < 30) {
      setTimeout(() => attemptInsert(retry + 1), 2000);
    } else {
      logError_ACU('[ACU-V2] menu button registration aborted: #extensionsMenu not found after 30 retries.');
    }
    return;
  }
  const existingContainer = $(`#${MENU_CONTAINER_ID}`, extensionsMenu);
  if (existingContainer.length > 0) {
    existingContainer
      .find(`#${MENU_ITEM_ID}`)
      .off(CLICK_NS)
      .on(CLICK_NS, handleClick);
    return;
  }
  const containerHtml =
    `<div class="extension_container interactable" id="${MENU_CONTAINER_ID}" tabindex="0"></div>`;
  const itemHtml =
    `<div class="list-group-item flex-container flexGap5 interactable" id="${MENU_ITEM_ID}" ` +
    `title="打开 ${ACU_PRODUCT_DISPLAY_NAME_ACU}">` +
    `<div class="fa-fw fa-solid fa-database extensionsMenuExtensionButton"></div>` +
    `<span>${ACU_PRODUCT_DISPLAY_NAME_ACU}</span>` +
    `</div>`;
  const $container = $(containerHtml);
  const $item = $(itemHtml);
  $item.on(CLICK_NS, handleClick);
  $container.append($item);
  extensionsMenu.append($container);
  logDebug_ACU(`[ACU-V2] menu button registered into ${getAcuHostSource()}`);
}

async function handleClick(event: Event): Promise<void> {
  event.stopPropagation();
  const doc = getAcuHostDocument();
  const $ = getHostJQuery();
  if ($ && doc) {
    const exMenuBtn = $('#extensionsMenuButton', doc);
    const extensionsMenu = $('#extensionsMenu', doc);
    if (exMenuBtn.length && extensionsMenu.is(':visible')) {
      exMenuBtn.trigger('click');
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
  await openAcuV2App();
}

function getHostJQuery(): any {
  const win = getAcuHostWindow() as any;
  return win?.jQuery || win?.$ || (window as any).jQuery || (window as any).$;
}
