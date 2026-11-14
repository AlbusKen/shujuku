/**
 * 将接口共享到全局, 使其可以在其他前端界面或脚本中使用.
 *
 * 其他前端界面或脚本将能通过 `await waitGlobalInitialized(global)` 来等待初始化完毕, 从而用 `global` 为变量名访问该接口.
 *
 * @param global 要共享的接口名称
 * @param value 要共享的接口内容
 *
 * @example
 * // 共享 Mvu 接口到全局
 * initializeGlobal('Mvu', Mvu);
 * // 此后其他前端界面或脚本中可以通过 `await waitGlobalInitialized('Mvu')` 来等待初始化完毕, 从而用 `Mvu` 为变量名访问该接口
 */
declare function initializeGlobal(global: LiteralUnion<'Mvu', string>, value: any): void;

/**
 * 等待其他前端界面或脚本中共享出来的全局接口初始化完毕, 并使之在当前前端界面或脚本中可用.
 *
 * 这需要其他前端界面或脚本通过 `initializeGlobal(global, value)` 来共享接口.
 *
 * @param global 要初始化的全局接口名称
 *
 * @example
 * await waitGlobalInitialized('Mvu');
 * ...此后可以直接使用 Mvu 接口
 */
declare function waitGlobalInitialized<T>(global: LiteralUnion<'Mvu', string>): Promise<T>;

type AutoCardUpdaterAgentWorldbookMode = 'disabled' | 'passive' | 'agent';
type AutoCardUpdaterSkillMetaUpdatedBy = 'manual' | 'agent-skillify';
type AutoCardUpdaterApiResult = Record<string, any>;
type AutoCardUpdaterAgentSkillifyCursor = { bookName: string; uid: string | number };
type AutoCardUpdaterAgentSkillifyOptions = {
    runTakeover?: boolean;
    bookNames?: string[] | string;
    selectedEntries?: Array<{ bookName: string; uid: string | number }>;
    presetName?: string;
    maxConcurrency?: number;
    maxAiRetries?: number;
    maxEntries?: number;
    overwriteManual?: boolean;
    cursor?: AutoCardUpdaterAgentSkillifyCursor;
};
type AutoCardUpdaterAgentSkillifyRunResult = {
    totalCandidates: number;
    totalMatched: number;
    selectedForRun: number;
    remaining: number;
    truncated: boolean;
    nextCursor?: AutoCardUpdaterAgentSkillifyCursor;
    updated: number;
    skipped: number;
    failed: number;
    results: Array<Record<string, any>>;
};
type AutoCardUpdaterAgentSkillifyApiResult = AutoCardUpdaterApiResult & { skillify?: AutoCardUpdaterAgentSkillifyRunResult };
type AutoCardUpdaterPromptSegment = {
    role: string;
    content: string;
    deletable: boolean;
    mainSlot?: string;
    isMain?: boolean;
    isMain2?: boolean;
};
type AutoCardUpdaterAgentContextSettings = Record<string, any>;
type AutoCardUpdaterSqlQueryResult = AutoCardUpdaterApiResult & {
    rows: Record<string, string | number | Uint8Array | null>[];
    limit?: number;
    offset?: number;
    sql?: string;
};
type AutoCardUpdaterSqlMutationResult = AutoCardUpdaterApiResult & {
    changes: number;
    errors?: string[];
    saved?: boolean;
    messageIndex?: number;
    saveError?: string;
};
type AutoCardUpdaterSqlBatchResult = AutoCardUpdaterSqlMutationResult & {
    success: boolean;
    modifiedKeys: string[];
    appliedEdits: number;
};
type AutoCardUpdaterSqlExecutionResult =
    | { type: 'query'; result: AutoCardUpdaterSqlQueryResult }
    | { type: 'mutation'; result: AutoCardUpdaterSqlMutationResult };
type AutoCardUpdaterSqlReadError = {
    method: 'executeSqlQuery' | 'querySql' | 'queryTableRows' | 'executeSql';
    code: 'runtime_not_ready' | 'alias_conflict' | 'table_not_found' | 'column_not_resolved' | 'sql_error' | 'read_only_violation';
    message: string;
    at: number;
};

interface AutoCardUpdaterAPI {
    registerTableUpdateCallback(callback: Function): void;
    unregisterTableUpdateCallback(callback: Function): void;
    _notifyTableUpdate(): void;
    registerTableFillStartCallback(callback: Function): void;
    _notifyTableFillStart(): void;

    exportTableAsJson(): Record<string, any>;
    importTableAsJson(jsonString: any, options?: any): Promise<boolean>;
    restoreTableAsJson(jsonString: any): Promise<boolean>;
    triggerUpdate(): Promise<boolean>;

    updateCell(tableNameOrOptions: any, rowIndex?: any, colIdentifier?: any, value?: any): Promise<boolean>;
    updateRow(tableNameOrOptions: any, rowIndex?: any, data?: any): Promise<boolean>;
    insertRow(tableNameOrOptions: any, data?: any): Promise<number>;
    deleteRow(tableNameOrOptions: any, rowIndex?: any): Promise<boolean>;

    getTableLockState(sheetKey: string): { rows: number[]; cols: number[]; cells: string[] } | null;
    setTableLockState(sheetKey: string, lockState?: { rows?: any[]; cols?: any[]; cells?: any[] }, options?: { merge?: boolean }): boolean;
    clearTableLocks(sheetKey: string): boolean;
    lockTableRow(sheetKey: string, rowIndex: number, locked?: boolean): boolean;
    lockTableCol(sheetKey: string, colIndex: number, locked?: boolean): boolean;
    lockTableCell(sheetKey: string, rowIndex: number, colIndex: number, locked?: boolean): boolean;
    toggleTableRowLock(sheetKey: string, rowIndex: number): boolean;
    toggleTableColLock(sheetKey: string, colIndex: number): boolean;
    toggleTableCellLock(sheetKey: string, rowIndex: number, colIndex: number): boolean;
    getSpecialIndexLockEnabled(sheetKey: string): boolean | null;
    setSpecialIndexLockEnabled(sheetKey: string, enabled: boolean): boolean;

    getTemplatePresetNames(): string[];
    switchTemplatePreset(presetName: any, options?: { scope?: 'global' | 'chat' }): Promise<AutoCardUpdaterApiResult>;
    injectTemplatePresetToCurrentChat(presetName: any): Promise<AutoCardUpdaterApiResult>;
    importTemplateFromData(templateData: any, options?: { scope?: 'global' | 'chat'; presetName?: string }): Promise<AutoCardUpdaterApiResult>;
    getTableTemplate(options?: { scope?: 'global' | 'chat'; presetName?: string }): any;

    getPlotPresets(): any[];
    getCurrentPlotPreset(): string;
    switchPlotPreset(presetName: any): boolean;
    injectPlotPresetToCurrentChat(presetName: any): boolean;
    getPlotPresetDetails(presetName: any): any;
    getPlotPresetNames(): string[];
    importPlotPresetFromData(presetData: any, options?: { overwrite?: boolean; switchTo?: boolean }): Promise<AutoCardUpdaterApiResult>;
    importPlotPresetsFromData(presetsArray: any[], options?: { overwrite?: boolean }): Promise<AutoCardUpdaterApiResult>;
    exportAllPlotPresets(): any[];
    initGameSession(characterData: any, options?: any): Promise<AutoCardUpdaterApiResult>;

    importTemplate(options?: any): Promise<boolean>;
    exportTemplate(options?: any): Promise<boolean>;
    resetTemplate(options?: any): Promise<boolean>;
    resetAllDefaults(): Promise<boolean>;
    exportJsonData(): Promise<boolean>;
    importCombinedSettings(): Promise<boolean>;
    exportCombinedSettings(): Promise<boolean>;
    overrideWithTemplate(): Promise<boolean>;
    migrateLegacyVectorIndex(): Promise<boolean>;
    openVisualizer(): Promise<boolean>;
    importTxtAndSplit(): Promise<boolean>;
    importTxtTextAndSplit(text: string, options?: { splitSize?: number | string; clearPrevious?: boolean }): Promise<AutoCardUpdaterApiResult>;
    injectImportedSelected(options?: { targetWorldbook?: string; selectedSheetKeys?: string[]; maxRetries?: number | string; requestOptions?: any }): Promise<AutoCardUpdaterApiResult>;
    injectImportedStandard(): Promise<boolean>;
    injectImportedSummary(): Promise<boolean>;
    injectImportedFull(): Promise<boolean>;
    deleteImportedEntries(): Promise<boolean>;
    clearImportedEntries(clearAll?: boolean): Promise<boolean>;
    clearImportedLorebookEntries(options: { targetWorldbook: string }): Promise<{ success: true; deletedCount: number; targetWorldbook: string } | { success: false; error: string }>;
    clearImportCache(clearAll?: boolean): Promise<boolean>;
    mergeSummaryNow(): Promise<boolean>;

    getUpdateConfigParams(): { autoUpdateThreshold: number; autoUpdateFrequency: number; updateBatchSize: number; autoUpdateTokenThreshold: number };
    setUpdateConfigParams(params: Partial<{ autoUpdateThreshold: number; autoUpdateFrequency: number; updateBatchSize: number; autoUpdateTokenThreshold: number }>): boolean;
    getManualSelectedTables(): { selectedTables: string[]; hasManualSelection: boolean };
    setManualSelectedTables(sheetKeys: string[]): boolean;
    clearManualSelectedTables(): boolean;
    getApiPresets(): any[];
    getTableApiPreset(): string;
    setTableApiPreset(presetName: string): boolean;
    getPlotApiPreset(): string;
    setPlotApiPreset(presetName: string): boolean;
    saveApiPreset(presetData: { name: string; apiMode?: string; apiConfig?: any; tavernProfile?: string }): boolean;
    loadApiPreset(presetName: string): boolean;
    deleteApiPreset(presetName: string): boolean;
    openSettings(): Promise<boolean>;
    manualUpdate(): Promise<boolean>;
    getAgentPromptConfig(): Promise<{ contextSettings: AutoCardUpdaterAgentContextSettings; agentDecisionPromptSegments: AutoCardUpdaterPromptSegment[]; agentSkillifyPromptSegments: AutoCardUpdaterPromptSegment[] }>;
    getAgentContextSettings(): Promise<AutoCardUpdaterAgentContextSettings>;
    setAgentContextSettings(patch: Partial<AutoCardUpdaterAgentContextSettings>): Promise<boolean>;
    resetAgentContextSettings(): Promise<boolean>;
    getAgentDecisionPromptSegments(): Promise<AutoCardUpdaterPromptSegment[]>;
    setAgentDecisionPromptSegments(segments: AutoCardUpdaterPromptSegment[]): Promise<boolean>;
    resetAgentDecisionPromptSegments(): Promise<boolean>;
    getAgentSkillifyPromptSegments(): Promise<AutoCardUpdaterPromptSegment[]>;
    setAgentSkillifyPromptSegments(segments: AutoCardUpdaterPromptSegment[]): Promise<boolean>;
    resetAgentSkillifyPromptSegments(): Promise<boolean>;

    syncWorldbookEntries(options?: { createIfNeeded?: boolean }): Promise<boolean>;
    refreshDataAndWorldbook(options?: { awaitFrontendReadback?: boolean }): Promise<boolean>;
    reoptimizeMessage(messageIndex: any): Promise<boolean>;
    cancelContentOptimization(reason?: any): boolean;
    deleteInjectedEntries(): Promise<boolean>;
    setOutlineEntryEnabled(enabled: any): Promise<boolean>;
    setZeroTkOccupyMode(modeEnabled: any): Promise<boolean>;
    getWorldbookEntrySkillMeta(bookName: any, uid: any): Promise<any | null>;
    listWorldbookSkillMetas(bookNames?: string[] | string): Promise<any[]>;
    callAI(messages: any[], options?: { presetName?: string; max_tokens?: number; maxTokens?: number }): Promise<string | null>;
    getStoryContext(maxTurns?: number): string;

    getAgentWorldbookControl(): Promise<AutoCardUpdaterApiResult>;
    setAgentWorldbookMode(mode: AutoCardUpdaterAgentWorldbookMode, options?: { runTakeover?: boolean; restoreOnDisable?: boolean }): Promise<AutoCardUpdaterApiResult>;
    runAgentWorldbookSkillify(options?: AutoCardUpdaterAgentSkillifyOptions): Promise<AutoCardUpdaterAgentSkillifyApiResult>;
    skillifyWorldbookEntries(options?: AutoCardUpdaterAgentSkillifyOptions): Promise<AutoCardUpdaterAgentSkillifyApiResult>;
    saveAgentWorldbookSkillMeta(bookName: any, uid: any, metaDraft: any, updatedBy?: AutoCardUpdaterSkillMetaUpdatedBy | { updatedBy?: AutoCardUpdaterSkillMetaUpdatedBy }): Promise<AutoCardUpdaterApiResult>;
    saveWorldbookEntrySkillMeta(bookName: any, uid: any, metaDraft: any, options?: AutoCardUpdaterSkillMetaUpdatedBy | { updatedBy?: AutoCardUpdaterSkillMetaUpdatedBy }): Promise<AutoCardUpdaterApiResult>;
    deleteAgentWorldbookSkillMeta(bookName: any, uid: any): Promise<AutoCardUpdaterApiResult>;
    deleteWorldbookEntrySkillMeta(bookName: any, uid: any): Promise<AutoCardUpdaterApiResult>;
    clearAgentWorldbookSkillMetas(bookNames?: string[]): Promise<AutoCardUpdaterApiResult>;

    executeSqlQuery?(sqlOrOptions: any, params?: any, options?: any): AutoCardUpdaterSqlQueryResult | null;
    querySql?(sqlOrOptions: any, params?: any, options?: any): AutoCardUpdaterSqlQueryResult | null;
    queryTableRows?(options: { sheetKey?: string; tableName?: string; table?: string; columns?: string[]; where?: Record<string, any>; orderBy?: any; order?: any; limit?: number; offset?: number }): AutoCardUpdaterSqlQueryResult | null;
    executeSqlMutation(sqlOrOptions: any, params?: any, options?: any): Promise<AutoCardUpdaterSqlMutationResult>;
    executeSqlBatch(sqlOrOptions: any, options?: any): Promise<AutoCardUpdaterSqlBatchResult>;
    executeSql(sqlOrOptions: any, params?: any, options?: any): Promise<AutoCardUpdaterSqlExecutionResult | null>;
    getLastSqlApiError(): AutoCardUpdaterSqlReadError | null;
}

interface Window {
    AutoCardUpdaterAPI?: AutoCardUpdaterAPI;
}

declare var AutoCardUpdaterAPI: AutoCardUpdaterAPI | undefined;

