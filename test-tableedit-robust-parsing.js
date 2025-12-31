// 测试 tableEdit 块健壮解析功能的脚本
// 这个脚本用于验证 extractTableEditInner_ACU 函数是否能正确处理各种边缘情况

console.log('tableEdit 块健壮解析功能测试');

// 模拟测试场景：
// 1. 标准格式：<tableEdit>...</tableEdit>
// 2. 缺失开标签：... </tableEdit>
// 3. 缺失闭标签：<tableEdit> ...
// 4. 仅注释包裹：<!-- insertRow(...) -->
// 5. 混合格式：<!-- insertRow(...) --></tableEdit>
// 6. 无效内容：无 insertRow/updateRow/deleteRow 的内容

// 测试数据
const testCases = [
    {
        name: '标准格式',
        input: `Log: 解析成功
Checklist: 已验证
<tableEdit>
<!-- insertRow(0, {"0":"测试","1":"数据"}) -->
</tableEdit>`,
        expected: true,
        expectedInner: 'insertRow(0, {"0":"测试","1":"数据"})'
    },
    {
        name: '缺失开标签（只有闭标签）',
        input: `Log: 解析成功
Checklist: 已验证
<!--
insertRow(0, {"0":"测试","1":"数据"})
-->
</tableEdit>`,
        expected: true,
        expectedInner: 'insertRow(0, {"0":"测试","1":"数据"})'
    },
    {
        name: '缺失闭标签（只有开标签）',
        input: `Log: 解析成功
Checklist: 已验证
<tableEdit>
<!--
insertRow(0, {"0":"测试","1":"数据"})
-->
`,
        expected: true,
        expectedInner: 'insertRow(0, {"0":"测试","1":"数据"})'
    },
    {
        name: '仅注释包裹（无标签）',
        input: `Log: 解析成功
Checklist: 已验证
<!--
insertRow(0, {"0":"测试","1":"数据"})
-->`,
        expected: true,
        expectedInner: 'insertRow(0, {"0":"测试","1":"数据"})'
    },
    {
        name: '混合格式（注释+闭标签）',
        input: `Log: 解析成功
Checklist: 已验证
<!--
insertRow(0, {"0":"测试","1":"数据"})
-->
</tableEdit>`,
        expected: true,
        expectedInner: 'insertRow(0, {"0":"测试","1":"数据"})'
    },
    {
        name: '无效内容（无指令）',
        input: `Log: 解析成功
Checklist: 已验证
<tableEdit>
<!-- 这是普通的注释文本 -->
</tableEdit>`,
        expected: false
    },
    {
        name: 'JS字符串拼接格式',
        input: `'Log: 解析成功
Checklist: 已验证
<tableEdit>
' +
          '<!-- insertRow(0, {"0":"测试","1":"数据"}) -->
' +
          '</tableEdit>'`,
        expected: true,
        expectedInner: 'insertRow(0, {"0":"测试","1":"数据"})'
    },
    {
        name: '用户提供的实际示例',
        input: `'<!--\n' +



          'insertRow(0, {"0":"平波号甲板", "1":"1712-09-10 21:50", "2":"1712-09-10 21:20", "3":"约30分钟"})\n' +

          'insertRow(1, {"0":"陈墨", "1":"男/15岁", "2":"容貌精致如画，极易被误认作绝色少女；身高约170cm，身形挺拔修长。被迫女装时会十分害羞，但性格其实开朗幽默。", "3":"大理寺司直/麟青砚亲传学生", "4":"原都察院监察御史之子，10岁时因父被冤 杀而全家连坐，后被麟青砚庇护、查清真相并收为弟子。武学天资聪颖，擅长家传长虹剑法，年轻一辈佼佼者。刚经历被叶惊鸿误认性别后的愤怒与羞恼，随后在与龙骧的冲突中负伤，被麟青砚救下。", "5":"刚直，话多，心细如发，非常关心他人，对师父麟青砚忠诚且感激。情绪积极乐观，无屈辱、眼神空洞、绝望、麻木等负面情绪。"})\n' +

          'insertRow(2, {"0":"麟青砚", "1":"女/29岁", "2":"身高约171cm，身形匀称而充满力量感。面部轮廓利落分明，眉宇间自带英气。耀眼夺目的金色长发梳成长长的双马尾，发辫向上缠绕过头顶的双角，再从角后披散于背。尊贵且深邃的紫色瞳孔，眼神锐利。肤色健康象牙白。头顶生有一对峥嵘的天生龙角。着便于活动的黑色露腋紧身上衣与同色亵裤，外披绣有八卦与雷纹的宽大天师道袍。", "3":"惊蛰;大理寺少卿官印令牌", "4":"否", "5":"天乾王朝长公主，当今天子麟承佑的亲姐姐。自幼展现惊人武学与道法天赋，肩负 大理寺与天师府双重重任，查办要案，威震朝野。在断魂湾对峙中以雷法震慑龙骧，发现鬼船平波号，并初步判断茅山道介入。对陈墨有较强的保护欲和关心，但保持严师形象。"})\n' +

          'insertRow(2, {"0":"龙骧", "1":"男/23岁", "2":"身材健硕，古铜色皮肤，双目圆睁时自带威慑感。性格直率火爆，嘴上 不饶人，但眼神中也流露出对麟青砚美貌与身份的贪婪与评估。使用沉重的“断浪刀”。", "3":"断浪刀", "4":"否", "5":"九江水寨大当家龙啸天的义子，水寨年轻一辈中最勇猛的悍将。忠心于义父，深信水寨所做一切为兄弟生计。误认陈墨为女性并出言调戏，随后被麟青砚的雷法震慑。对麟青砚的美貌与身份产生觊觎，表面服软但实则暗中跟随。"})\n' +

          'insertRow(3, {"0":"长虹剑法", "1":"主动", "2":"初窥门径", "3":"家传剑法，势如长虹贯日，气势磅礴，在年轻一辈中属上乘。可在近身格斗中迅速出击，以精妙剑招克敌。"})\n' +

          'insertRow(3, {"0":"五雷天心正法", "1":"主动", "2":"精通", "3":"天师府正法，能引动天雷。可发出蓝紫色电弧震慑敌人，全力施为时能以剑引雷，凭借内力悬浮于空。"})\n' +

          'insertRow(4, {"0":"惊蛰", "1":"1", "2":"陨铁长剑，可引动天雷。", "3":"武器"})\n' +

          'insertRow(4, {"0":"长虹剑", "1":"1", "2":"陈墨家传佩剑，剑身折射七彩流光。", "3":"武器"})\n' +

          'insertRow(4, {"0":"雨前龙井", "1":"2", "2":"上好的茶叶，提神醒脑。", "3":"消耗品"})\n' +

          'insertRow(4, {"0":"大理寺少卿官印令牌", "1":"1", "2":"麟青砚的身份象征。", "3":"杂物"})\n' +

          'insertRow(4, {"0":"九环大刀", "1":"1", "2":"龙骧使用的沉重钢刀。", "3":"武器"})\n' +

          'insertRow(5, {"0":"江南府·鬼船之谜", "1":"主线任务", "2":"麟青砚（代皇帝）", "3":"查清清波运河"平波号"官银失窃案真相，找出幕后真凶，重振朝廷权威。", "4":"师徒二人已抵达平波号甲板，发现船员尸体与茅山道引魂符，龙骧被震慑后已暂时退去。", "5":"无", "6":"恢复朝廷权威，惩治罪犯。", "7":"朝廷权威进一步受损，地方势力坐大。"})\n' +

          'insertRow(6, {"0":"1712-09-10 21:20 - 21:50", "1":"天乾王朝-江南府-断魂湾", "2":"大理寺官船在驶向断魂湾途中遭遇九江水寨少当家龙骧率众拦截。龙骧误认陈墨为女性并出言调戏，陈墨反击。龙骧随即下令接舷战，陈墨在抵挡中略显吃力并受伤。麟青砚及时出手，以雷法震慑龙骧，迫使其收敛攻势。麟青砚随后指出鬼船平波号的位置，龙骧及水匪被鬼船的诡异气息震慑，最终退去。师徒二人登上了平波号甲板，发现船员尸体惨状，并在舱门上发现茅山道的引魂符，一道凄厉哭声炸响，舱门缓缓开启。", "3":"龙骧: "九江水寨办事！闲杂船只速退！"; 麟青砚: "大理寺查案，让路。"; 陈墨: "老子是男的！"; 麟青砚: "闹够了没有？"; 龙骧: "或者需要人暖床，随时招呼一声。"; 麟青砚: "狗咬你一口，你还要咬回去不成？"; 麟青砚: "那是引魂符，茅山道的野路子。"", "4":"AM03"})\n' +

          'insertRow(7, {"0":"1712-09-10 21:20 - 21:50", "1":"师徒遭遇九江水寨拦截，麟青砚震慑龙骧，发现鬼船并登船勘察，遭遇茅山道术法。", "2":"AM03"})\n' +

          '-->\n' +

          '</tableEdit>\n' +`,
        expected: true,
        expectedInner: 'insertRow(0, {"0":"平波号甲板", "1":"1712-09-10 21:50", "2":"1712-09-10 21:20", "3":"约30分钟"})\n' +
                      'insertRow(1, {"0":"陈墨", "1":"男/15岁", "2":"容貌精致如画，极易被误认作绝色少女；身高约170cm，身形挺拔修长。被迫女装时会十分害羞，但性格其实开朗幽默。", "3":"大理寺司直/麟青砚亲传学生", "4":"原都察院监察御史之子，10岁时因父被冤 杀而全家连坐，后被麟青砚庇护、查清真相并收为弟子。武学天资聪颖，擅长家传长虹剑法，年轻一辈佼佼者。刚经历被叶惊鸿误认性别后的愤怒与羞恼，随后在与龙骧的冲突中负伤，被麟青砚救下。", "5":"刚直，话多，心细如发，非常关心他人，对师父麟青砚忠诚且感激。情绪积极乐观，无屈辱、眼神空洞、绝望、麻木等负面情绪。"})\n' +
                      'insertRow(2, {"0":"麟青砚", "1":"女/29岁", "2":"身高约171cm，身形匀称而充满力量感。面部轮廓利落分明，眉宇间自带英气。耀眼夺目的金色长发梳成长长的双马尾，发辫向上缠绕过头顶的双角，再从角后披散于背。尊贵且深邃的紫色瞳孔，眼神锐利。肤色健康象牙白。头顶生有一对峥嵘的天生龙角。着便于活动的黑色露腋紧身上衣与同色亵裤，外披绣有八卦与雷纹的宽大天师道袍。", "3":"惊蛰;大理寺少卿官印令牌", "4":"否", "5":"天乾王朝长公主，当今天子麟承佑的亲姐姐。自幼展现惊人武学与道法天赋，肩负 大理寺与天师府双重重任，查办要案，威震朝野。在断魂湾对峙中以雷法震慑龙骧，发现鬼船平波号，并初步判断茅山道介入。对陈墨有较强的保护欲和关心，但保持严师形象。"})\n' +
                      'insertRow(2, {"0":"龙骧", "1":"男/23岁", "2":"身材健硕，古铜色皮肤，双目圆睁时自带威慑感。性格直率火爆，嘴上 不饶人，但眼神中也流露出对麟青砚美貌与身份的贪婪与评估。使用沉重的"断浪刀"。", "3":"断浪刀", "4":"否", "5":"九江水寨大当家龙啸天的义子，水寨年轻一辈中最勇猛的悍将。忠心于义父，深信水寨所做一切为兄弟生计。误认陈墨为女性并出言调戏，随后被麟青砚的雷法震慑。对麟青砚的美貌与身份产生觊觎，表面服软但实则暗中跟随。"})\n' +
                      'insertRow(3, {"0":"长虹剑法", "1":"主动", "2":"初窥门径", "3":"家传剑法，势如长虹贯日，气势磅礴，在年轻一辈中属上乘。可在近身格斗中迅速出击，以精妙剑招克敌。"})\n' +
                      'insertRow(3, {"0":"五雷天心正法", "1":"主动", "2":"精通", "3":"天师府正法，能引动天雷。可发出蓝紫色电弧震慑敌人，全力施为时能以剑引雷，凭借内力悬浮于空。"})\n' +
                      'insertRow(4, {"0":"惊蛰", "1":"1", "2":"陨铁长剑，可引动天雷。", "3":"武器"})\n' +
                      'insertRow(4, {"0":"长虹剑", "1":"1", "2":"陈墨家传佩剑，剑身折射七彩流光。", "3":"武器"})\n' +
                      'insertRow(4, {"0":"雨前龙井", "1":"2", "2":"上好的茶叶，提神醒脑。", "3":"消耗品"})\n' +
                      'insertRow(4, {"0":"大理寺少卿官印令牌", "1":"1", "2":"麟青砚的身份象征。", "3":"杂物"})\n' +
                      'insertRow(4, {"0":"九环大刀", "1":"1", "2":"龙骧使用的沉重钢刀。", "3":"武器"})\n' +
                      'insertRow(5, {"0":"江南府·鬼船之谜", "1":"主线任务", "2":"麟青砚（代皇帝）", "3":"查清清波运河"平波号"官银失窃案真相，找出幕后真凶，重振朝廷权威。", "4":"师徒二人已抵达平波号甲板，发现船员尸体与茅山道引魂符，龙骧被震慑后已暂时退去。", "5":"无", "6":"恢复朝廷权威，惩治罪犯。", "7":"朝廷权威进一步受损，地方势力坐大。"})\n' +
                      'insertRow(6, {"0":"1712-09-10 21:20 - 21:50", "1":"天乾王朝-江南府-断魂湾", "2":"大理寺官船在驶向断魂湾途中遭遇九江水寨少当家龙骧率众拦截。龙骧误认陈墨为女性并出言调戏，陈墨反击。龙骧随即下令接舷战，陈墨在抵挡中略显吃力并受伤。麟青砚及时出手，以雷法震慑龙骧，迫使其收敛攻势。麟青砚随后指出鬼船平波号的位置，龙骧及水匪被鬼船的诡异气息震慑，最终退去。师徒二人登上了平波号甲板，发现船员尸体惨状，并在舱门上发现茅山道的引魂符，一道凄厉哭声炸响，舱门缓缓开启。", "3":"龙骧: "九江水寨办事！闲杂船只速退！"; 麟青砚: "大理寺查案，让路。"; 陈墨: "老子是男的！"; 麟青砚: "闹够了没有？"; 龙骧: "或者需要人暖床，随时招呼一声。"; 麟青砚: "狗咬你一口，你还要咬回去不成？"; 麟青砚: "那是引魂符，茅山道的野路子。"", "4":"AM03"})\n' +
                      'insertRow(7, {"0":"1712-09-10 21:20 - 21:50", "1":"师徒遭遇九江水寨拦截，麟青砚震慑龙骧，发现鬼船并登船勘察，遭遇茅山道术法。", "2":"AM03"})'
    }
];

// 模拟 extractTableEditInner_ACU 函数（从主文件中复制的逻辑）
function normalizeAiResponseForTableEditParsing_ACU(text) {
    if (typeof text !== 'string') return '';
    let cleaned = text.trim();
    cleaned = cleaned.replace(/'\s*\+\s*'/g, '');
    if (cleaned.startsWith("'") && cleaned.endsWith("'")) cleaned = cleaned.slice(1, -1);
    cleaned = cleaned.replace(/\\n/g, '\n');
    cleaned = cleaned.replace(/\\\\"/g, '\\"');
    cleaned = cleaned.replace(/：/g, ':');
    return cleaned;
}

function extractTableEditInner_ACU(text, options = {}) {
    const { allowNoTableEditTags = true } = options;
    const cleaned = normalizeAiResponseForTableEditParsing_ACU(text);
    if (!cleaned) return null;

    // 1) 标准格式：<tableEdit>...</tableEdit>
    const fullMatch = cleaned.match(/<tableEdit>([\s\S]*?)<\/tableEdit>/i);
    if (fullMatch && typeof fullMatch[1] === 'string') {
        return { inner: fullMatch[1], cleaned, mode: 'full' };
    }

    // 2) 只有闭标签的格式：...</tableEdit>
    if (allowNoTableEditTags && cleaned.includes('</tableEdit>')) {
        const endTagMatch = cleaned.match(/^([\s\S]*?)<\/tableEdit>/i);
        if (endTagMatch && typeof endTagMatch[1] === 'string') {
            const candidate = endTagMatch[1].trim();
            if (candidate.includes('<!--') && candidate.includes('-->') &&
                (candidate.includes('insertRow') || candidate.includes('updateRow') || candidate.includes('deleteRow'))) {
                return { inner: candidate.replace(/<!--|-->/g, '').trim(), cleaned, mode: 'end_only' };
            }
        }
    }

    // 3) 只有开标签的格式：<tableEdit>...
    if (allowNoTableEditTags && cleaned.includes('<tableEdit>')) {
        const startTagMatch = cleaned.match(/<tableEdit>([\s\S]*)$/i);
        if (startTagMatch && typeof startTagMatch[1] === 'string') {
            const candidate = startTagMatch[1].trim();
            if (candidate.includes('<!--') && candidate.includes('-->') &&
                (candidate.includes('insertRow') || candidate.includes('updateRow') || candidate.includes('deleteRow'))) {
                return { inner: candidate.replace(/<!--|-->/g, '').trim(), cleaned, mode: 'start_only' };
            }
        }
    }

    // 4) 纯注释块格式：<!-- ... -->（无 tableEdit 标签）
    if (allowNoTableEditTags) {
        const commentMatch = cleaned.match(/<!--([\s\S]*?)-->/);
        if (commentMatch && typeof commentMatch[1] === 'string') {
            const innerContent = commentMatch[1].trim();
            if (innerContent.includes('insertRow') || innerContent.includes('updateRow') || innerContent.includes('deleteRow')) {
                return { inner: innerContent, cleaned, mode: 'comment_only' };
            }
        }
    }

    return null; // 没有找到有效的内容
}

// 运行测试
console.log('开始测试 tableEdit 块健壮解析功能...\n');

testCases.forEach((testCase, index) => {
    console.log(`测试 ${index + 1}: ${testCase.name}`);
    const result = extractTableEditInner_ACU(testCase.input, { allowNoTableEditTags: true });

    const success = !!result === testCase.expected;
    if (success && result && testCase.expectedInner) {
        success = result.inner.trim() === testCase.expectedInner.trim();
    }

    console.log(`  期望结果: ${testCase.expected ? '成功' : '失败'}`);
    console.log(`  实际结果: ${result ? '成功' : '失败'}`);
    if (result) {
        console.log(`  解析模式: ${result.mode}`);
        console.log(`  提取内容长度: ${result.inner.length} 字符`);
        if (testCase.expectedInner) {
            console.log(`  内容匹配: ${result.inner.trim() === testCase.expectedInner.trim() ? '✓' : '✗'}`);
        }
    }
    console.log(`  测试结果: ${success ? '✓ 通过' : '✗ 失败'}\n`);
});

console.log('测试完成！如果所有测试都通过，说明 tableEdit 块健壮解析功能正常工作。');
console.log('现在插件应该能正确处理各种缺失标签的情况，包括你提到的实际案例。');
