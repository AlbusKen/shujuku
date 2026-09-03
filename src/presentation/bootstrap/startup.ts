/**
 * presentation/bootstrap/startup.ts — 启动 + 菜单初始化
 * 从 features/startup/01_ready_and_menu.js 迁移而来
 */

import { MENU_ITEM_CONTAINER_ID_ACU } from '../../shared/data-constants';
import { getUiSurface_ACU } from '../../shared/ui-surface-registry';
import { jQuery_API_ACU } from '../dom-utils';
import { MENU_ITEM_ID_ACU, SCRIPT_ID_PREFIX_ACU } from '../../shared/constants';
import { logDebug_ACU, logError_ACU } from '../../shared/utils';
import { applyLegacyUiMenuVisibility } from '../../shared/legacy-ui-menu-entry';

  export function addAutoCardMenuItem_ACU() {
    const parentDoc = (window.parent || window).document;
    if (!parentDoc || !jQuery_API_ACU) {
      logError_ACU('Cannot find parent document or jQuery for ACU menu.');
      return false;
    }
    const extensionsMenu = jQuery_API_ACU('#extensionsMenu', parentDoc);
    if (!extensionsMenu.length) {
      setTimeout(addAutoCardMenuItem_ACU, 2000);
      return false;
    }
    let $menuItemContainer = jQuery_API_ACU(`#${MENU_ITEM_CONTAINER_ID_ACU}`, extensionsMenu);
    if ($menuItemContainer.length > 0) {
      $menuItemContainer
        .find(`#${MENU_ITEM_ID_ACU}`)
        .off(`click.${SCRIPT_ID_PREFIX_ACU}`)
        .on(`click.${SCRIPT_ID_PREFIX_ACU}`, async function (e) {
          e.stopPropagation();
          const exMenuBtn = jQuery_API_ACU('#extensionsMenuButton', parentDoc);
          if (exMenuBtn.length && extensionsMenu.is(':visible')) {
            exMenuBtn.trigger('click');
            await new Promise(r => setTimeout(r, 150));
          }
          // [V1 收敛] 旧菜单入口改为打开 V2 设置面板，不再可达旧 popup 写 UI。
          await getUiSurface_ACU()?.openSettings?.();
        });
      applyLegacyUiMenuVisibility();
      return true;
    }
    $menuItemContainer = jQuery_API_ACU(
      `<div class="extension_container interactable" id="${MENU_ITEM_CONTAINER_ID_ACU}" tabindex="0"></div>`,
    );
    const menuItemHTML = `<div class="list-group-item flex-container flexGap5 interactable" id="${MENU_ITEM_ID_ACU}" title="打开 SP·数据库 9.2.3"><div class="fa-fw fa-solid fa-database extensionsMenuExtensionButton"></div><span>SP·数据库 9.2.3</span></div>`;
    const $menuItem = jQuery_API_ACU(menuItemHTML);
    $menuItem.on(`click.${SCRIPT_ID_PREFIX_ACU}`, async function (e) {
      e.stopPropagation();
      const exMenuBtn = jQuery_API_ACU('#extensionsMenuButton', parentDoc);
      if (exMenuBtn.length && extensionsMenu.is(':visible')) {
        exMenuBtn.trigger('click');
        await new Promise(r => setTimeout(r, 150));
      }
      // [V1 收敛] 旧菜单入口改为打开 V2 设置面板，不再可达旧 popup 写 UI。
      await getUiSurface_ACU()?.openSettings?.();
    });
    $menuItemContainer.append($menuItem);
    extensionsMenu.append($menuItemContainer);
    applyLegacyUiMenuVisibility();
    logDebug_ACU('ACU Menu item added.');
    return true;
  }
