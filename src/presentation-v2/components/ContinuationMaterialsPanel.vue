<template>
  <div class="acu-v2-continuation-materials">
    <div class="acu-v2-continuation-materials__tabs">
      <button
        v-for="tab in TABS"
        :key="tab.id"
        type="button"
        class="acu-v2-continuation-materials__tab"
        :class="{ 'acu-v2-continuation-materials__tab--active': activeTab === tab.id }"
        @click="activeTab = tab.id"
      >{{ tab.label }}</button>
      <div class="acu-v2-continuation-materials__tab-actions">
        <AcuButton :loading="busy" @click="reload()">刷新</AcuButton>
        <AcuButton variant="danger" :loading="busy" @click="requestClear">一键清空</AcuButton>
      </div>
    </div>

    <p v-if="clearPending" class="acu-v2-continuation-materials__confirm">
      清空会删除当前续写任务、主 Agent 的会话记录与本地资料快照（伏笔、信息差、长期约束、故事总纲、年代学、百科资料库）。
      小说正文楼层不受影响，清空后可以从当前剧情重新开始规划。
      <span class="acu-v2-continuation-materials__confirm-actions">
        <AcuButton variant="danger" :loading="busy" @click="confirmClear">确认清空</AcuButton>
        <AcuButton @click="clearPending = false">取消</AcuButton>
      </span>
    </p>

    <!-- 阶段大纲：当前阶段可编辑，历史阶段只读折叠 -->
    <template v-if="activeTab === 'outline'">
      <p v-if="!task" class="acu-v2-continuation-materials__empty">还没有续写任务，也就没有阶段大纲。</p>
      <template v-else>
        <div v-if="activeRevision && activeStage" class="acu-v2-continuation-materials__outline">
          <p class="acu-v2-continuation-materials__meta">
            当前：第 {{ activeStage?.stageNumber }} 阶段 · revision {{ activeRevision.revision }} · 已完成 {{ activeStage?.completedTurns ?? 0 }} 轮。
            已完成轮次与正在执行的轮次不可删除或替换，总轮数必须留在阶段规模范围内。
          </p>

          <section class="acu-v2-continuation-materials__outline-summary">
            <p class="acu-v2-continuation-materials__outline-heading">
              <strong>第 {{ activeStage.stageNumber }} 阶段：{{ activeRevision.outline.title }}</strong>
              <span class="acu-v2-continuation-materials__badge acu-v2-continuation-materials__badge--primary">{{ TEMPO_LABELS[activeRevision.outline.tempo] ?? activeRevision.outline.tempo }}</span>
              <span class="acu-v2-continuation-materials__badge">职责：{{ ROLE_LABELS[activeRevision.outline.role ?? ''] ?? activeRevision.outline.role ?? '未标注' }}</span>
              <span class="acu-v2-continuation-materials__badge">revision {{ activeRevision.revision }}</span>
              <span class="acu-v2-continuation-materials__badge">{{ activeRevision.frozen ? '已冻结' : '待确认' }}</span>
            </p>
            <p class="acu-v2-continuation-materials__card-body">阶段目标：{{ activeRevision.outline.goal }}</p>
            <p class="acu-v2-continuation-materials__card-meta">故事时间目标：{{ activeRevision.outline.timeSpanGoal ?? '未设定' }}</p>
            <p class="acu-v2-continuation-materials__card-meta">完成 {{ activeStage.completedTurns }} / {{ activeRevision.outline.totalTurns }} 轮 · 剩余 {{ remainingTurns(activeStage, activeRevision) }} 轮</p>
            <p class="acu-v2-continuation-materials__card-meta">
              所属 active 卷：{{ activeVolume ? `[${activeVolume.id}]「${activeVolume.title}」` : '未识别（故事总纲尚未加载或当前没有 active 卷）' }}
            </p>
          </section>

          <div class="acu-v2-continuation-materials__outline-nodes">
            <section v-for="(node, nodeIndex) in activeRevision.outline.nodes" :key="node.id" class="acu-v2-continuation-materials__outline-node">
              <p class="acu-v2-continuation-materials__card-head"><strong>{{ node.title }}</strong><span class="acu-v2-continuation-materials__badge">{{ node.turns.length }} 轮</span></p>
              <p class="acu-v2-continuation-materials__card-body">节点目标：{{ node.goal }}</p>
              <ol class="acu-v2-continuation-materials__turns">
                <li
                  v-for="(turn, turnIndex) in node.turns"
                  :key="turn.id"
                  :class="`acu-v2-continuation-materials__turn--${turnState(activeRevision, nodeIndex, turnIndex)}`"
                >
                  <span>第 {{ turnPosition(activeRevision, node.id, turnIndex) }} 轮 · {{ turn.goal }}</span>
                  <span class="acu-v2-continuation-materials__badge">{{ PACING_LABELS[turn.pacing] ?? turn.pacing }}</span>
                  <span class="acu-v2-continuation-materials__badge">功能：{{ FUNCTION_LABELS[turn.function ?? ''] ?? turn.function ?? '未标注' }}</span>
                  <span class="acu-v2-continuation-materials__badge">主线：{{ MAINLINE_LABELS[turn.mainlineDelta ?? ''] ?? turn.mainlineDelta ?? '未标注' }}</span>
                  <span class="acu-v2-continuation-materials__badge">时间：{{ TIME_LABELS[turn.timeAdvance ?? ''] ?? turn.timeAdvance ?? '未标注' }}<template v-if="turn.timeAnchor"> · {{ turn.timeAnchor }}</template></span>
                  <span v-if="turn.inferred?.length" class="acu-v2-continuation-materials__badge" title="这些字段由系统按节奏档保守补全，不是大纲模型或作者明确给出的；可在原始 JSON 里修正">系统补全：{{ turn.inferred.map(field => INFERRED_FIELD_LABELS[field] ?? field).join('、') }}</span>
                  <span v-if="turnState(activeRevision, nodeIndex, turnIndex) === 'current'" class="acu-v2-continuation-materials__badge acu-v2-continuation-materials__badge--primary">当前执行</span>
                </li>
              </ol>
            </section>
          </div>

          <details class="acu-v2-continuation-materials__json">
            <summary>编辑原始 JSON</summary>
            <p class="acu-v2-continuation-materials__card-meta">修改轮次目标时请同步核对 pacing、function、mainlineDelta、timeAdvance 与 timeAnchor；缺少的语义字段保存时会按 pacing 补默认并标注「系统补全」，标注为 inferred 的字段改成明确值后标注自动消失。</p>
            <AcuTextarea :model-value="outlineDraft" :rows="16" @update:model-value="onOutlineInput" />
            <p v-if="outlineError" class="acu-v2-continuation-materials__error">{{ outlineError }}</p>
            <div class="acu-v2-continuation-materials__actions">
              <AcuButton :disabled="!outlineDirty" @click="syncOutlineDraft">放弃修改</AcuButton>
              <AcuButton variant="primary" :loading="busy" :disabled="!outlineDirty" @click="saveOutline">保存大纲</AcuButton>
            </div>
          </details>
        </div>
        <p v-else class="acu-v2-continuation-materials__empty">当前没有已冻结的阶段大纲可编辑。</p>

        <details
          v-for="stage in historyStages"
          :key="stage.stageId"
          class="acu-v2-continuation-materials__block"
          open
        >
          <summary>第 {{ stage.stageNumber }} 阶段 · {{ stage.status }} · {{ stage.completedTurns }} / {{ stageTotalTurns(stage) }} 轮</summary>
          <template v-for="revision in [displayRevision(stage)]" :key="revision?.revision ?? 'no-revision'">
            <section v-if="revision" class="acu-v2-continuation-materials__outline-summary">
              <p class="acu-v2-continuation-materials__outline-heading"><strong>{{ revision.outline.title }}</strong><span class="acu-v2-continuation-materials__badge">revision {{ revision.revision }}</span><span class="acu-v2-continuation-materials__badge">{{ revision.frozen ? '已冻结' : '待确认' }}</span><span class="acu-v2-continuation-materials__badge">职责：{{ ROLE_LABELS[revision.outline.role ?? ''] ?? revision.outline.role ?? '未标注' }}</span></p>
              <p class="acu-v2-continuation-materials__card-body">阶段目标：{{ revision.outline.goal }}</p>
              <ol class="acu-v2-continuation-materials__list">
                <li v-for="node in revision.outline.nodes" :key="node.id"><strong>{{ node.title }}</strong>：{{ node.goal }}<ol><li v-for="turn in node.turns" :key="turn.id">{{ turn.goal }} · {{ PACING_LABELS[turn.pacing] ?? turn.pacing }} · {{ FUNCTION_LABELS[turn.function ?? ''] ?? turn.function ?? '未标注' }} · 主线 {{ MAINLINE_LABELS[turn.mainlineDelta ?? ''] ?? turn.mainlineDelta ?? '未标注' }} · {{ TIME_LABELS[turn.timeAdvance ?? ''] ?? turn.timeAdvance ?? '未标注' }}<template v-if="turn.timeAnchor">（{{ turn.timeAnchor }}）</template></li></ol></li>
              </ol>
            </section>
            <p v-else class="acu-v2-continuation-materials__empty">该阶段没有可展示的 revision。</p>
          </template>
          <details v-if="olderRevisions(stage).length" class="acu-v2-continuation-materials__history">
            <summary>旧 revision（{{ olderRevisions(stage).length }}）</summary>
            <details v-for="revision in olderRevisions(stage)" :key="revision.revision" class="acu-v2-continuation-materials__history-revision">
              <summary>revision {{ revision.revision }} · {{ revision.reason }} · {{ revision.outline.title }}</summary>
              <ol class="acu-v2-continuation-materials__list"><li v-for="node in revision.outline.nodes" :key="node.id"><strong>{{ node.title }}</strong>：{{ node.goal }}</li></ol>
            </details>
          </details>
        </details>
      </template>
    </template>

    <!-- 本地资料：伏笔 / 信息差 / 长期约束 分类型结构化展示，各自独立 JSON 编辑与保存 -->
    <template v-else-if="activeTab === 'modules'">
      <p class="acu-v2-continuation-materials__meta">
        本地资料由子代理结算写入，也可以在这里分模块手动修正。保存走与子代理相同的结构校验并推进修订号；
        每个模块独立保存，只提交本模块数据，不影响其他模块（含未保存的草稿）。
      </p>
      <p v-if="materials.snapshot.value" class="acu-v2-continuation-materials__meta">
        结算水位：楼层 {{ materials.snapshot.value.settledThroughIndex }} ·
        伏笔 {{ materials.snapshot.value.hooks.length }} 条 ·
        信息差 {{ materials.snapshot.value.infoGap.length }} 条 ·
        长期约束 {{ materials.snapshot.value.constraints.length }} 条 ·
        故事时间 {{ materials.snapshot.value.chronology.length }} 条 ·
        修订号 {{ materials.snapshot.value.revisions.hooks }}/{{ materials.snapshot.value.revisions.infoGap }}/{{ materials.snapshot.value.revisions.constraints }}/{{ materials.snapshot.value.revisions.chronology }}
      </p>
      <p v-if="materials.snapshot.value" class="acu-v2-continuation-materials__meta">
        <template v-if="materials.diagnostics.value.adoptedIndex === null">
          当前聊天没有任何楼层带有资料快照。快照由子代理结算后写到当时的末楼，并跟着该楼层走：该楼被删除、重新生成或 swipe 时，资料会回退到更早楼层的快照；若此前只写过一次，就会回到空。
        </template>
        <template v-else>
          资料来源：楼层 {{ materials.diagnostics.value.adoptedIndex }}<template v-if="materials.diagnostics.value.salvaged">（该楼快照未通过严格校验，已按宽容模式读取，损坏记录已丢弃）</template>。
          <template v-if="materials.diagnostics.value.candidates.some(item => !item.valid)">
            另有 {{ materials.diagnostics.value.candidates.filter(item => !item.valid).length }} 个楼层的快照结构损坏被跳过：
            <span v-for="item in materials.diagnostics.value.candidates.filter(entry => !entry.valid)" :key="item.index">楼层 {{ item.index }}（{{ item.problems.slice(0, 3).join('；') }}）；</span>
          </template>
        </template>
      </p>
      <p v-if="materials.loadError.value" class="acu-v2-continuation-materials__error">{{ materials.loadError.value }}</p>

      <!-- 伏笔账本 -->
      <details class="acu-v2-continuation-materials__block" open>
        <summary>伏笔账本 · {{ materials.snapshot.value?.hooks.length ?? 0 }} 条<span v-if="materials.modules.hooks.dirty" class="acu-v2-continuation-materials__badge">未保存</span></summary>
        <p v-if="!materials.snapshot.value?.hooks.length" class="acu-v2-continuation-materials__empty">还没有伏笔条目。</p>
        <div v-else class="acu-v2-continuation-materials__cards">
          <div
            v-for="hook in materials.snapshot.value.hooks"
            :key="hook.id"
            class="acu-v2-continuation-materials__card"
            :class="{ 'acu-v2-continuation-materials__card--retired': hook.retired }"
          >
            <p class="acu-v2-continuation-materials__card-head">
              <strong>{{ hook.id }}</strong>
              <span class="acu-v2-continuation-materials__badge">{{ HOOK_STATUS_LABELS[hook.status] ?? hook.status }}</span>
              <span class="acu-v2-continuation-materials__badge">{{ HOOK_IMPORTANCE_LABELS[hook.importance] ?? hook.importance }}</span>
              <span v-if="hook.retired" class="acu-v2-continuation-materials__badge acu-v2-continuation-materials__badge--muted">已退休{{ hook.retiredReason ? `：${hook.retiredReason}` : '' }}</span>
            </p>
            <p class="acu-v2-continuation-materials__card-body">{{ hook.summary }}</p>
            <p class="acu-v2-continuation-materials__card-meta">植入楼层 {{ hook.plantedIndex }} · 最近更新楼层 {{ hook.updatedIndex }}<template v-if="hook.plannedPayoff"> · 计划回收：{{ hook.plannedPayoff }}</template></p>
          </div>
        </div>
        <details class="acu-v2-continuation-materials__json">
          <summary>编辑原始 JSON</summary>
          <AcuTextarea :model-value="materials.modules.hooks.draft" :rows="12" @update:model-value="value => materials.updateDraft('hooks', value)" />
          <p v-if="materials.modules.hooks.error" class="acu-v2-continuation-materials__error">{{ materials.modules.hooks.error }}</p>
          <div class="acu-v2-continuation-materials__actions">
            <AcuButton :disabled="!materials.modules.hooks.dirty" @click="materials.discard('hooks')">放弃修改</AcuButton>
            <AcuButton variant="primary" :loading="materials.modules.hooks.saving" :disabled="!materials.modules.hooks.dirty" @click="materials.save('hooks')">保存伏笔账本</AcuButton>
          </div>
        </details>
      </details>

      <!-- 认知与信息差 -->
      <details class="acu-v2-continuation-materials__block" open>
        <summary>认知与信息差 · {{ materials.snapshot.value?.infoGap.length ?? 0 }} 条<span v-if="materials.modules.infoGap.dirty" class="acu-v2-continuation-materials__badge">未保存</span></summary>
        <p v-if="!materials.snapshot.value?.infoGap.length" class="acu-v2-continuation-materials__empty">还没有信息差条目。</p>
        <div v-else class="acu-v2-continuation-materials__cards">
          <div
            v-for="gap in materials.snapshot.value.infoGap"
            :key="gap.id"
            class="acu-v2-continuation-materials__card"
            :class="{ 'acu-v2-continuation-materials__card--retired': gap.retired }"
          >
            <p class="acu-v2-continuation-materials__card-head">
              <strong>{{ gap.id }}</strong>
              <span>{{ gap.topic }}</span>
              <span class="acu-v2-continuation-materials__badge">{{ REVEAL_STATUS_LABELS[gap.revealStatus] ?? gap.revealStatus }}</span>
              <span v-if="gap.revealIndex !== null" class="acu-v2-continuation-materials__badge acu-v2-continuation-materials__badge--muted">揭示楼层 {{ gap.revealIndex }}</span>
              <span v-if="gap.retired" class="acu-v2-continuation-materials__badge acu-v2-continuation-materials__badge--muted">已退休{{ gap.retiredReason ? `：${gap.retiredReason}` : '' }}</span>
            </p>
            <p class="acu-v2-continuation-materials__card-body">客观事实：{{ gap.objectiveFact }}</p>
            <p class="acu-v2-continuation-materials__card-meta">读者已知：{{ gap.readerKnown || '（未记录）' }}</p>
            <p v-for="knowledge in gap.characterKnowledge" :key="knowledge.name" class="acu-v2-continuation-materials__card-meta">
              {{ knowledge.name }} 知道：{{ knowledge.knows }}
            </p>
          </div>
        </div>
        <details class="acu-v2-continuation-materials__json">
          <summary>编辑原始 JSON</summary>
          <AcuTextarea :model-value="materials.modules.infoGap.draft" :rows="12" @update:model-value="value => materials.updateDraft('infoGap', value)" />
          <p v-if="materials.modules.infoGap.error" class="acu-v2-continuation-materials__error">{{ materials.modules.infoGap.error }}</p>
          <div class="acu-v2-continuation-materials__actions">
            <AcuButton :disabled="!materials.modules.infoGap.dirty" @click="materials.discard('infoGap')">放弃修改</AcuButton>
            <AcuButton variant="primary" :loading="materials.modules.infoGap.saving" :disabled="!materials.modules.infoGap.dirty" @click="materials.save('infoGap')">保存信息差</AcuButton>
          </div>
        </details>
      </details>

      <!-- 长期约束 -->
      <details class="acu-v2-continuation-materials__block" open>
        <summary>长期约束 · {{ materials.snapshot.value?.constraints.length ?? 0 }} 条<span v-if="materials.modules.constraints.dirty" class="acu-v2-continuation-materials__badge">未保存</span></summary>
        <p v-if="!materials.snapshot.value?.constraints.length" class="acu-v2-continuation-materials__empty">还没有长期约束。</p>
        <div v-else class="acu-v2-continuation-materials__cards">
          <div v-for="constraint in materials.snapshot.value.constraints" :key="constraint.id" class="acu-v2-continuation-materials__card">
            <p class="acu-v2-continuation-materials__card-head"><strong>{{ constraint.id }}</strong></p>
            <p class="acu-v2-continuation-materials__card-body">{{ constraint.text }}</p>
            <p class="acu-v2-continuation-materials__card-meta">登记楼层 {{ constraint.createdIndex }}<template v-if="constraint.reason"> · 缘由：{{ constraint.reason }}</template></p>
          </div>
        </div>
        <details class="acu-v2-continuation-materials__json">
          <summary>编辑原始 JSON</summary>
          <AcuTextarea :model-value="materials.modules.constraints.draft" :rows="10" @update:model-value="value => materials.updateDraft('constraints', value)" />
          <p v-if="materials.modules.constraints.error" class="acu-v2-continuation-materials__error">{{ materials.modules.constraints.error }}</p>
          <div class="acu-v2-continuation-materials__actions">
            <AcuButton :disabled="!materials.modules.constraints.dirty" @click="materials.discard('constraints')">放弃修改</AcuButton>
            <AcuButton variant="primary" :loading="materials.modules.constraints.saving" :disabled="!materials.modules.constraints.dirty" @click="materials.save('constraints')">保存长期约束</AcuButton>
          </div>
        </details>
      </details>

      <!-- 故事年代学账本 -->
      <details class="acu-v2-continuation-materials__block" open>
        <summary>故事年代学账本 · {{ materials.snapshot.value?.chronology.length ?? 0 }} 条<span v-if="materials.modules.chronology.dirty" class="acu-v2-continuation-materials__badge">未保存</span></summary>
        <p v-if="!materials.snapshot.value?.chronology.length" class="acu-v2-continuation-materials__empty">还没有已结算的故事时间记录。时间事实由结算维护代理依据真实正文登记；大纲里的时间字段是计划。</p>
        <div v-else class="acu-v2-continuation-materials__cards">
          <div
            v-for="entry in materials.snapshot.value.chronology"
            :key="entry.id"
            class="acu-v2-continuation-materials__card"
            :class="{ 'acu-v2-continuation-materials__card--retired': entry.retired }"
          >
            <p class="acu-v2-continuation-materials__card-head">
              <strong>{{ entry.id }}</strong>
              <span>{{ entry.anchor }}</span>
              <span class="acu-v2-continuation-materials__badge">{{ CHRONOLOGY_PRECISION_LABELS[entry.precision] ?? entry.precision }}</span>
              <span v-if="entry.retired" class="acu-v2-continuation-materials__badge acu-v2-continuation-materials__badge--muted">已作废{{ entry.retiredReason ? `：${entry.retiredReason}` : '' }}</span>
            </p>
            <p class="acu-v2-continuation-materials__card-body">累计经过：{{ entry.elapsed }}</p>
            <p class="acu-v2-continuation-materials__card-body">时间转换：{{ entry.transition }}</p>
            <p class="acu-v2-continuation-materials__card-meta">证据楼层 {{ entry.evidenceIndexes.join('、') }} · 结算楼层 {{ entry.updatedIndex }}</p>
          </div>
        </div>
        <details class="acu-v2-continuation-materials__json">
          <summary>编辑原始 JSON</summary>
          <AcuTextarea :model-value="materials.modules.chronology.draft" :rows="10" @update:model-value="value => materials.updateDraft('chronology', value)" />
          <p v-if="materials.modules.chronology.error" class="acu-v2-continuation-materials__error">{{ materials.modules.chronology.error }}</p>
          <div class="acu-v2-continuation-materials__actions">
            <AcuButton :disabled="!materials.modules.chronology.dirty" @click="materials.discard('chronology')">放弃修改</AcuButton>
            <AcuButton variant="primary" :loading="materials.modules.chronology.saving" :disabled="!materials.modules.chronology.dirty" @click="materials.save('chronology')">保存年代学账本</AcuButton>
          </div>
        </details>
      </details>
    </template>

    <!-- 百科资料库：web-researcher 从互联网查到的原作/公开设定，按实体分条 -->
    <template v-else-if="activeTab === 'webRefs'">
      <p class="acu-v2-continuation-materials__meta">
        百科资料库由 web-researcher 子代理从萌娘百科、维基百科、百度百科或网页查到后写入，按实体（人物、法术、物品、事件…）分条。
        每条固定只有「名称 + 一句话简介」，详情自由格式。Agent 上下文里只注入预览行，详情由它们按 ID 精读。
        它记录的是原作/公开设定，不是本故事已发生的事实；与世界书或正文冲突时以后者为准。
      </p>
      <p v-if="materials.snapshot.value" class="acu-v2-continuation-materials__meta">
        条目 {{ materials.snapshot.value.webRefs.length }} 条（活跃 {{ materials.snapshot.value.webRefs.filter(entry => !entry.retired).length }}）· 修订号 {{ materials.snapshot.value.revisions.webRefs }}
      </p>
      <p v-if="materials.loadError.value" class="acu-v2-continuation-materials__error">{{ materials.loadError.value }}</p>
      <p v-if="!materials.snapshot.value?.webRefs.length" class="acu-v2-continuation-materials__empty">
        还没有百科资料。在续写设置里勾选「启用开场百科检索」后，新任务第一次规划前会自动检索；主 Agent 之后也可按需派工 web-researcher。
      </p>
      <div v-else class="acu-v2-continuation-materials__cards">
        <details
          v-for="ref in materials.snapshot.value.webRefs"
          :key="ref.id"
          class="acu-v2-continuation-materials__card"
          :class="{ 'acu-v2-continuation-materials__card--retired': ref.retired }"
        >
          <summary class="acu-v2-continuation-materials__card-head">
            <strong>{{ ref.id }}</strong>
            <span>{{ ref.title }}</span>
            <span class="acu-v2-continuation-materials__badge acu-v2-continuation-materials__badge--primary">{{ WEB_REF_SOURCE_LABELS[ref.source] ?? ref.source }}</span>
            <span v-for="tag in ref.tags" :key="tag" class="acu-v2-continuation-materials__badge">{{ tag }}</span>
            <span v-if="ref.sourceStatus !== 'ok'" class="acu-v2-continuation-materials__badge acu-v2-continuation-materials__badge--muted">{{ WEB_REF_STATUS_LABELS[ref.sourceStatus] ?? ref.sourceStatus }}</span>
            <span v-if="ref.retired" class="acu-v2-continuation-materials__badge acu-v2-continuation-materials__badge--muted">已退休{{ ref.retiredReason ? `：${ref.retiredReason}` : '' }}</span>
          </summary>
          <p class="acu-v2-continuation-materials__card-body">{{ ref.brief }}</p>
          <p v-if="ref.summary" class="acu-v2-continuation-materials__card-body">{{ ref.summary }}</p>
          <p class="acu-v2-continuation-materials__card-meta">
            <a :href="ref.url" target="_blank" rel="noopener noreferrer">{{ ref.url }}</a>
            <template v-if="ref.query"> · 检索词：{{ ref.query }}</template>
            <template v-if="ref.fetchedAt"> · 抓取于 {{ new Date(ref.fetchedAt).toLocaleString() }}</template>
          </p>
        </details>
      </div>
      <details class="acu-v2-continuation-materials__json">
        <summary>编辑原始 JSON</summary>
        <p class="acu-v2-continuation-materials__card-meta">每条至少需要 id、title（名称）、url、brief（一句话简介）；summary 为自由格式详情，tags 可选。网页原文不保存。手动新增的条目 source 可写 web。</p>
        <AcuTextarea :model-value="materials.modules.webRefs.draft" :rows="14" @update:model-value="value => materials.updateDraft('webRefs', value)" />
        <p v-if="materials.modules.webRefs.error" class="acu-v2-continuation-materials__error">{{ materials.modules.webRefs.error }}</p>
        <div class="acu-v2-continuation-materials__actions">
          <AcuButton :disabled="!materials.modules.webRefs.dirty" @click="materials.discard('webRefs')">放弃修改</AcuButton>
          <AcuButton variant="primary" :loading="materials.modules.webRefs.saving" :disabled="!materials.modules.webRefs.dirty" @click="materials.save('webRefs')">保存百科资料库</AcuButton>
        </div>
      </details>
    </template>

    <!-- 故事总纲：结构化展示 + JSON 编辑 -->
    <template v-else>
      <p class="acu-v2-continuation-materials__meta">
        故事总纲由 arc-architect 子代理维护：全书方向一条 + 若干卷台阶。也可以在这里手动修正，保存走同一套结构校验并推进修订号。
      </p>
      <p v-if="materials.snapshot.value" class="acu-v2-continuation-materials__meta">
        总纲 {{ materials.snapshot.value.storyArc.length }} 条 · 修订号 {{ materials.snapshot.value.revisions.storyArc }}
      </p>
      <p v-if="materials.loadError.value" class="acu-v2-continuation-materials__error">{{ materials.loadError.value }}</p>
      <p v-if="!materials.snapshot.value?.storyArc.length" class="acu-v2-continuation-materials__empty">
        还没有故事总纲。开始规划后主 Agent 会先派工 arc-architect 立总纲。
      </p>
      <div v-else class="acu-v2-continuation-materials__cards">
        <div
          v-for="arc in materials.snapshot.value.storyArc"
          :key="arc.id"
          class="acu-v2-continuation-materials__card"
          :class="{ 'acu-v2-continuation-materials__card--retired': arc.retired }"
        >
          <p class="acu-v2-continuation-materials__card-head">
            <strong>{{ arc.id }}</strong>
            <span class="acu-v2-continuation-materials__badge acu-v2-continuation-materials__badge--primary">{{ arc.scope === 'story' ? '全书方向' : '卷台阶' }}</span>
            <span class="acu-v2-continuation-materials__badge">{{ ARC_STATUS_LABELS[arc.status] ?? arc.status }}</span>
            <span>{{ arc.title }}</span>
            <span v-if="arc.retired" class="acu-v2-continuation-materials__badge acu-v2-continuation-materials__badge--muted">已退休{{ arc.retiredReason ? `：${arc.retiredReason}` : '' }}</span>
          </p>
          <p class="acu-v2-continuation-materials__card-body">方向：{{ arc.direction }}</p>
          <p v-if="arc.escalation" class="acu-v2-continuation-materials__card-body">冲突高度：{{ arc.escalation }}</p>
          <p v-if="arc.withheld" class="acu-v2-continuation-materials__card-meta">禁翻底牌：{{ arc.withheld }}</p>
          <p class="acu-v2-continuation-materials__card-meta">
            已承载阶段：{{ arc.stageNumbers.length ? arc.stageNumbers.join('、') : '（尚未承载）' }}
          </p>
        </div>
      </div>
      <details class="acu-v2-continuation-materials__json">
        <summary>编辑原始 JSON</summary>
        <AcuTextarea :model-value="materials.modules.storyArc.draft" :rows="14" @update:model-value="value => materials.updateDraft('storyArc', value)" />
        <p v-if="materials.modules.storyArc.error" class="acu-v2-continuation-materials__error">{{ materials.modules.storyArc.error }}</p>
        <div class="acu-v2-continuation-materials__actions">
          <AcuButton :disabled="!materials.modules.storyArc.dirty" @click="materials.discard('storyArc')">放弃修改</AcuButton>
          <AcuButton variant="primary" :loading="materials.modules.storyArc.saving" :disabled="!materials.modules.storyArc.dirty" @click="materials.save('storyArc')">保存故事总纲</AcuButton>
        </div>
      </details>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import AcuButton from './_lib/AcuButton.vue';
import AcuTextarea from './_lib/AcuTextarea.vue';
import { useContinuationMaterials } from '../composables/useContinuationMaterials';
import type { ContinuationStage_ACU, ContinuationTask_ACU, StageOutline_ACU, StageRevision_ACU } from '../../service/continuation/model'; // arch-ok: 仅类型导入，用于 props 标注，编译后无运行时依赖

const props = defineProps<{
  task: ContinuationTask_ACU | null;
  activeStage: ContinuationStage_ACU | null;
  activeRevision: StageRevision_ACU | null;
  busy: boolean;
}>();

const emit = defineEmits<{
  (event: 'save-outline', outline: StageOutline_ACU): void;
  (event: 'clear'): void;
}>();

const TABS = [
  { id: 'outline', label: '阶段大纲' },
  { id: 'modules', label: '本地资料' },
  { id: 'storyArc', label: '故事总纲' },
  { id: 'webRefs', label: '百科资料' },
] as const;

type TabId = typeof TABS[number]['id'];

const HOOK_STATUS_LABELS: Record<string, string> = {
  planted: '已埋设', reinforced: '已强化', misled: '已误导', partially_paid: '部分回收', paid: '已回收', abandoned: '已放弃',
};
const HOOK_IMPORTANCE_LABELS: Record<string, string> = { high: '重要度：高', mid: '重要度：中', low: '重要度：低' };
const REVEAL_STATUS_LABELS: Record<string, string> = { unrevealed: '未揭示', partial: '部分揭示', revealed: '已揭示' };
const CHRONOLOGY_PRECISION_LABELS: Record<string, string> = { exact: '精确', approximate: '近似', unknown: '未知' };
const ARC_STATUS_LABELS: Record<string, string> = { planned: '计划中', active: '进行中', done: '已完成' };
const WEB_REF_SOURCE_LABELS: Record<string, string> = { moegirl: '萌娘百科', wikipedia_zh: '中文维基', wikipedia_en: '英文维基', baidu: '百度百科', web: '网页' };
const WEB_REF_STATUS_LABELS: Record<string, string> = { ok: '正常', unavailable: '来源不可用', blocked: '被拦截' };
const TEMPO_LABELS: Record<string, string> = { buildup: '铺垫型', mixed: '起伏型', surge: '高压型', aftermath: '余波型' };
const ROLE_LABELS: Record<string, string> = { setup: '建立', development: '发展', escalation: '升级', turn: '转折', payoff: '兑现', aftermath: '余波' };
const PACING_LABELS: Record<string, string> = { setup: '铺垫', pressure: '施压', turn: '转折', cooldown: '缓冲' };
const FUNCTION_LABELS: Record<string, string> = { daily_bond: '关系日常', daily_world: '世界日常', recovery: '恢复', preparation: '准备', training: '训练', economy: '经营', side_thread: '支线', conflict: '冲突', reveal: '揭示', payoff: '兑现', transition: '过渡' };
const MAINLINE_LABELS: Record<string, string> = { hold: '停驻', micro: '微增量', step: '推进', milestone: '里程碑' };
const TIME_LABELS: Record<string, string> = { continuous: '连续', same_day: '同日稍后', overnight: '隔夜', days: '数日', weeks: '数周', months: '数月', years: '数年' };
const INFERRED_FIELD_LABELS: Record<string, string> = { function: '功能', mainlineDelta: '主线', timeAdvance: '时间' };

const activeTab = ref<TabId>('outline');
const materials = useContinuationMaterials();
const outlineDraft = ref('');
const outlineError = ref('');
const outlineDirty = ref(false);
const clearPending = ref(false);
const activeVolume = computed(() => materials.snapshot.value?.storyArc.find(entry => entry.scope === 'volume' && !entry.retired && entry.status === 'active') ?? null);
const historyStages = computed(() => (props.task?.stages ?? []).filter(stage => stage.stageId !== props.activeStage?.stageId));

function displayRevision(stage: ContinuationStage_ACU): StageRevision_ACU | null {
  return stage.revisions.find(revision => revision.revision === stage.activeRevision)
    ?? stage.revisions.reduce<StageRevision_ACU | null>((latest, revision) => !latest || revision.revision > latest.revision ? revision : latest, null);
}

function olderRevisions(stage: ContinuationStage_ACU): StageRevision_ACU[] {
  const displayed = displayRevision(stage);
  return stage.revisions.filter(revision => revision.revision !== displayed?.revision).sort((left, right) => right.revision - left.revision);
}

function remainingTurns(stage: ContinuationStage_ACU, revision: StageRevision_ACU): number {
  return Math.max(0, revision.outline.totalTurns - stage.completedTurns);
}

function stageTotalTurns(stage: ContinuationStage_ACU): number {
  return stage.revisions.find(item => item.revision === stage.activeRevision)?.outline.totalTurns ?? 0;
}

/** 某个节点内第 turnIndex 轮在整个阶段里的全局轮号（从 1 起），用于已完成轮次的置灰标记。 */
function turnPosition(revision: StageRevision_ACU, nodeId: string, turnIndex: number): number {
  let position = 0;
  for (const node of revision.outline.nodes) {
    if (node.id === nodeId) return position + turnIndex + 1;
    position += node.turns.length;
  }
  return position + turnIndex + 1;
}

function turnState(revision: StageRevision_ACU, nodeIndex: number, turnIndex: number): 'done' | 'current' | 'planned' {
  const stage = props.activeStage;
  if (!stage || revision.revision !== props.activeRevision?.revision) return 'planned';
  const node = revision.outline.nodes[nodeIndex];
  if (!node) return 'planned';
  if (turnPosition(revision, node.id, turnIndex) <= stage.completedTurns) return 'done';
  if (nodeIndex === stage.activeNodeIndex && turnIndex === stage.activeTurnIndex) return 'current';
  return 'planned';
}

function syncOutlineDraft(): void {
  outlineDraft.value = props.activeRevision ? JSON.stringify(props.activeRevision.outline, null, 2) : '';
  outlineError.value = '';
  outlineDirty.value = false;
}

function onOutlineInput(value: string): void {
  outlineDraft.value = value;
  outlineDirty.value = true;
}

function saveOutline(): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outlineDraft.value);
  } catch (error) {
    outlineError.value = error instanceof Error ? `大纲 JSON 无法解析：${error.message}` : '大纲 JSON 无法解析';
    return;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    outlineError.value = '大纲必须是 JSON 对象';
    return;
  }
  outlineError.value = '';
  emit('save-outline', parsed as StageOutline_ACU);
}

/**
 * 重读资料快照与大纲草稿。
 * @param options.preserveDirty Agent 运行中的自动刷新传 true：只刷新未编辑的模块，用户手里的草稿保留。
 */
function reload(options: { preserveDirty?: boolean } = {}): void {
  materials.reload(options);
  if (!options.preserveDirty || !outlineDirty.value) syncOutlineDraft();
}

function requestClear(): void {
  clearPending.value = true;
}

function confirmClear(): void {
  clearPending.value = false;
  emit('clear');
}

onMounted(() => reload());

/** 权威大纲变更（Agent 改写、保存成功）后重置草稿；用户正在编辑时不覆盖他的输入。 */
watch(() => `${props.activeStage?.stageId ?? ''}:${props.activeRevision?.revision ?? ''}`, () => {
  if (!outlineDirty.value) syncOutlineDraft();
}, { immediate: true });

defineExpose({ reload });
</script>

<style scoped>
.acu-v2-continuation-materials { display: grid; gap: 12px; }
.acu-v2-continuation-materials__tabs { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.acu-v2-continuation-materials__tab { padding: 5px 12px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 22%, transparent); border-radius: 999px; background: transparent; color: var(--acu-text-2); cursor: pointer; font: inherit; font-size: var(--acu-font-size-body, 12px); }
.acu-v2-continuation-materials__tab--active { border-color: color-mix(in srgb, var(--acu-primary, #5b8def) 55%, transparent); background: color-mix(in srgb, var(--acu-primary, #5b8def) 14%, transparent); color: var(--acu-text-1); }
.acu-v2-continuation-materials__tab-actions { display: flex; gap: 6px; margin-left: auto; }
.acu-v2-continuation-materials__confirm { margin: 0; padding: 10px; border: 1px solid color-mix(in srgb, var(--acu-danger, #d65b5b) 40%, transparent); border-radius: 6px; background: color-mix(in srgb, var(--acu-danger, #d65b5b) 7%, transparent); color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-continuation-materials__confirm-actions { display: inline-flex; gap: 6px; margin-left: 8px; vertical-align: middle; }
.acu-v2-continuation-materials__outline { display: grid; gap: 8px; }
.acu-v2-continuation-materials__empty { margin: 0; color: var(--acu-text-3); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-continuation-materials__meta { margin: 0; color: var(--acu-text-3); font-size: var(--acu-font-size-body, 12px); white-space: pre-wrap; }
.acu-v2-continuation-materials__error { margin: 0; color: var(--acu-danger, #d65b5b); white-space: pre-wrap; font-size: var(--acu-font-size-body, 12px); }
.acu-v2-continuation-materials__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.acu-v2-continuation-materials__block { padding: 10px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 20%, transparent); border-radius: 6px; display: grid; gap: 8px; }
.acu-v2-continuation-materials__block > summary { cursor: pointer; color: var(--acu-text-1); }
.acu-v2-continuation-materials__block--current { border-color: color-mix(in srgb, var(--acu-primary, #5b8def) 45%, transparent); }
.acu-v2-continuation-materials__list { display: flex; flex-direction: column; gap: 6px; padding-left: 22px; color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-continuation-materials__outline-summary, .acu-v2-continuation-materials__outline-node { padding: 10px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 16%, transparent); border-radius: 6px; display: grid; gap: 5px; }
.acu-v2-continuation-materials__outline-heading { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: var(--acu-text-1); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-continuation-materials__outline-nodes { display: grid; gap: 8px; }
.acu-v2-continuation-materials__turns { display: grid; gap: 5px; margin: 0; padding-left: 22px; color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-continuation-materials__turns > li { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.acu-v2-continuation-materials__turn--done { color: var(--acu-text-3); }
.acu-v2-continuation-materials__turn--current { padding: 5px 7px; margin-left: -7px; border-radius: 4px; background: color-mix(in srgb, var(--acu-primary, #5b8def) 14%, transparent); color: var(--acu-text-1); }
.acu-v2-continuation-materials__turn--planned { color: var(--acu-text-2); }
.acu-v2-continuation-materials__cards { display: grid; gap: 8px; }
.acu-v2-continuation-materials__card { padding: 8px 10px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 16%, transparent); border-radius: 6px; display: grid; gap: 4px; }
.acu-v2-continuation-materials__card--retired { opacity: 0.55; }
.acu-v2-continuation-materials__card > summary.acu-v2-continuation-materials__card-head { cursor: pointer; list-style: none; }
.acu-v2-continuation-materials__card-meta a { color: inherit; word-break: break-all; }
.acu-v2-continuation-materials__card-head { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: var(--acu-text-1); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-continuation-materials__card-body { margin: 0; color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); white-space: pre-wrap; }
.acu-v2-continuation-materials__card-meta { margin: 0; color: var(--acu-text-3); font-size: var(--acu-font-size-body, 12px); white-space: pre-wrap; }
.acu-v2-continuation-materials__badge { padding: 1px 8px; border-radius: 999px; border: 1px solid color-mix(in srgb, var(--acu-text-3) 30%, transparent); color: var(--acu-text-2); font-size: 11px; }
.acu-v2-continuation-materials__badge--primary { border-color: color-mix(in srgb, var(--acu-primary, #5b8def) 55%, transparent); color: var(--acu-text-1); background: color-mix(in srgb, var(--acu-primary, #5b8def) 12%, transparent); }
.acu-v2-continuation-materials__badge--muted { opacity: 0.8; }
.acu-v2-continuation-materials__json { display: grid; gap: 8px; }
.acu-v2-continuation-materials__json > summary { cursor: pointer; color: var(--acu-text-2); font-size: var(--acu-font-size-body, 12px); }
.acu-v2-continuation-materials__history { display: grid; gap: 8px; }
.acu-v2-continuation-materials__history-revision { padding: 8px; border-left: 2px solid color-mix(in srgb, var(--acu-text-3) 28%, transparent); }

/* 手机窄屏：刷新/清空按钮换到独立一行靠右，避免和页签挤成两行半。 */
@media (max-width: 640px) {
  .acu-v2-continuation-materials__tab-actions { margin-left: 0; width: 100%; justify-content: flex-end; }
  .acu-v2-continuation-materials__confirm-actions { display: flex; margin: 8px 0 0; }
}
</style>
