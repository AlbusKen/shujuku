import type { WorldActor_ACU } from '../../service/simulation/model';
import { showCustomConfirm_ACU } from './custom-confirm';

/** 每次仅询问一位新人物；确认框直接挂载于酒馆主页面。 */
export async function confirmWorldActorRegistration_ACU(
  actor: WorldActor_ACU,
  signal: AbortSignal,
): Promise<boolean> {
  const action = actor.currentAction?.text?.trim();
  return showCustomConfirm_ACU(
    '新增人物谱角色',
    `姓名：${actor.name}\n位置：${actor.location}\n当前动作：${action ? action.slice(0, 100) : '暂无'}`,
    { confirmLabel: '同意新增', cancelLabel: '不新增', signal, appearance: 'actor-registration-light' },
  );
}
