# AStraGame 复刻项目：AI 接手执行文档

更新时间：2026-09-06（Asia/Shanghai）。这是当前工作区的交接快照，不是完整复刻验收报告。

## 1. 最终目标与当前阶段

目标是复刻用户指定的微信小游戏《镇邪人》的世界探索与自由战斗体验，并能够接入诛神 H5 工程。范围包括世界地图、迷雾及解锁、手电筒、2.5D 表现、自动寻路、多人阵型、英雄技能、伤害、普通敌人与 Boss 行为、状态机及相关成长流程。

当前阶段：第一张世界地图的可玩原型已经建立，核心框架、首段主线和隔离宿主适配已经跑通。尚未达到完整内容、原版行为与数值一致、正式宿主及真机验收的最终目标。

不要用自动测试通过、配置转换成功、截图能显示或少数技能演示代替完整验收。现在没有完整加权任务清单，不应给出精确的总完成百分比或交付工期。

## 2. 接手前必须知道的边界

- 仓库根目录：`C:\Users\Administrator\Desktop\code\ai\game\client`。外层 `game` 不是本项目 Git 根目录。
- 先阅读仓库根目录的 `AGENTS.md`；后续更深目录如出现同名文件，也须遵守其适用范围。
- 用户已经授权本项目初始化 Git、提交并推送到指定仓库。远端当前为 `git@github.com:SakuraTCuu/AstraGame.git`，分支为 `main`。
- 保留既有未提交改动，不执行全仓库回退或覆盖；按文件核对并提交。推送后验证远端提交，不能将本地提交描述为已经推送。
- 用户授权临时使用指定微信资源缓存及观察原版小游戏。缓存只读；参考资源、转换后的原版配置、截图和补充下载只保存在忽略目录，不进入 Git 或宿主导出包。
- 不提取、运行或提交原版游戏脚本。资源适配通过自有代码实现。当前临时资源方案不等于正式发布资源方案。
- 原始诛神工程 `D:\group\zhushen\client` 是 SVN 工作副本，目前仅用于读取、类型检查和隔离复制。现阶段不要直接向原工程安装或覆盖模块；正式接入属于后续独立交付步骤。
- 不更换 Creator、自定义引擎、宿主依赖版本，不为本任务修复宿主中无关的既有问题。
- 用户希望直接推进、少问重复问题。必要时报告具体阻塞，不反复只输出计划。只有明确要求时才使用子代理。

## 3. 本次接手的 Git 状态

2026-09-06 核对时：

- HEAD：`a3efbb5fae03c7aa596faf9ec097336de3b9b922`，说明为 `Preserve source targeting rules and separate cast targets`。
- `git status --short --branch` 显示 `main...origin/main`，有 17 个已暂存文件。
- 暂存内容是最新的目标 Buff 分组、嘲讽控制、英雄 31 美术部署支持及对应测试和记录；已经验证，但尚未提交推送。
- 本交接文档是此后新建的文件，是否已提交须以接手时 Git 状态为准。
- `origin/main` 是本地远端跟踪引用，接手时如需确认服务器最新状态，使用 `git ls-remote origin refs/heads/main`。

已有暂存文件清单，供检查是否混入其他工作：

```text
assets/scripts/core/actor/Actor.ts
assets/scripts/core/ai/EnemyAI.ts
assets/scripts/core/ai/PlayerAI.ts
assets/scripts/core/combat/Combat.ts
assets/scripts/core/combat/SkillEffects.ts
assets/scripts/core/demo/DemoSession.ts
assets/scripts/presentation/DemoRenderer.ts
assets/scripts/presentation/ReferenceArtLayer.ts
docs/local-reference-preview.md
tests/control-states.test.ts
tests/reference-cache.test.ts
tests/target-buffs-taunt.test.ts
tools/fetch-reference-atlas.mjs
tools/reference-cache.mjs
tools/reference-skills.mjs
tools/reference-smoke.mjs
tools/reference-taunt-smoke.mjs
```

不要重复实现这批功能。优先审阅暂存差异，将已验证工作收口为提交，再开始下一项行为修改。

## 4. 当前量化快照与统计口径

以下数字直接来自本地 `build/web-mobile/reference-preview/profile.json` 和 `audit.json`；重新生成后可能变化。

| 项目 | 当前值 | 正确解读 |
| --- | --- | --- |
| 世界 | 诡域秘闻，第一张地图 | 不是全部世界 |
| 所需详细地表 | 844，缺失 0 | 含缩略图共 845 个纹理条目；不代表角色和物件美术全部齐备 |
| 敌人及资源模板 / 配置出生点 | 135 / 2489 | 配置覆盖不等于每个点位都已人工验收 |
| 迷雾区域 / 传送点 | 59 / 31 | 已适配条件；后续模式前置仍有缺口 |
| 额外交互 / 前景遮挡多边形 | 73 / 549 | 仍需扩大原版对照范围 |
| 英雄配置 / 可部署适配 | 44 / 26 | 可部署不代表该英雄所有技能、星级和表现完整 |
| 运行配置技能定义 | 236 | `profile.skills.definitions.length` |
| 源技能编译统计 | 224 | `audit.compiledSkills`，与运行定义采用不同统计入口，不可混用 |
| 技能审计记录 / 类别 | 394 / 50 | 包含未支持、未校准及重复引用；不是 394 个独立同等大小的缺陷 |
| 成长流程审计记录 | 53 | 应按具体条件、奖励与模式逐条处理 |
| 缺失美术记录 | 945 | 含出生点关联记录，应按资源去重后规划；不等于 945 个独立素材 |
| 任务配置 | 156 主线、30 首领首杀、324 段位任务 | 共 510 条配置；目前仅前段流程完成自然通关验证 |

旧文档仍有“23 个可部署英雄”等历史数字，以及早期“宿主运行待验证”的记录。当前以本节快照和最新验证记录为准，历史记录不可当作最新状态。

## 5. 已实现及验证范围

### 5.1 工程、地图、探索

- Cocos Creator 2.4.15 项目，自有 TypeScript 核心逻辑与展示、输入、宿主服务分离。
- 固定 20 Hz 模拟、可控随机、A*、碰撞、手动移动与自动路线切换、阻挡迷雾入口接近及付费后恢复路线。
- 第一张原版世界地表、原版碰撞网格映射、可平移缩放总览、目的地选择与已修复传送点移动。
- 原版迷雾条件、等级、段位、累计击杀、任务、NPC 交互及资源消耗；区域手电筒开关、方向光及环境光。
- 角色地面 Y 排序、前景遮挡、身体高度与地面位置分离，支持击飞展示。
- 按配置及宿主角色隔离存档，保存探索、资源、成长、队伍、永久清理和刷新计时等状态。

### 5.2 队伍和成长

- 八个阵位，第五至第八位分别要求段位 4、10、19、28；英雄上阵、下阵、交换、跟随、归队及存活队长切换。
- 角色等级和段位上限、按阵位装备、属性随机及持久化、血量比例保留、替补血量与能量。
- 普通招募券消耗、配置权重、基础保底及存档；主线跟踪、导航、奖励领取及首杀奖励。
- 九个主线步骤、首个 Boss、装备及奖励流程已通过自然模拟路径验证，未使用传送或战斗属性覆盖。
- 团灭后回城或回已修复传送点的本地恢复流程已实现，但费用、时间、能量与敌人重置规则尚未与原版完整核实。

### 5.3 战斗

- 普攻、战术与大招的准备、命中、后摇、冷却、共享冷却组、能量与生命复合消耗、独立技能计数资源。
- 多段命中、追踪和方向弹道、扫掠碰撞、总命中预算、重复命中间隔、持续区域、跟随和移动区域、周期治疗及伤害。
- 独立 Buff 和状态计时、周期叠层、部分固有特性、治疗、净化、击退、击飞、恐惧、定身、沉默、眩晕和冻结。
- 护盾、无敌、不可选中、禁疗、保留一血、单次伤害限制，以及控制、位移和打断免疫的分离。
- 分离追击目标与施法目标；支持最近、最低生命比例、可复现随机、职业优先级和指定攻击属性排序。
- Boss 部分血量阶段、突进、跳跃、多圈预警、错峰落点、移动冲撞、护盾维持施法、破盾后续、寻路回中心及完成后的范围终结技。
- 最新暂存的嘲讽：强制有效施加者成为普攻目标，限制战术和大招，处理打断、免疫、净化、来源失效及到期恢复。
- 最新目标 Buff：同一帧伤害与 Buff 复用接收者组；死亡不补选，数量变化不污染其他动作，每个主追踪弹道分别持有目标组。

以上是能力列表，不是每个原版英雄和 Boss 的完整实现声明。

### 5.4 诛神宿主

- 模块导出、冲突检查、清单及类型检查已建立。
- 隔离工程实际使用宿主 `UIManager`、`BaseUI`、资源、消息、存储、计时等服务。
- 已验证打开、返回、销毁、缓存重开、角色切换、延迟加载过程中关闭以及保存角色隔离。
- 这不是原工程正式安装，也不是完整登录、联网和重连流程验证。

## 6. 未完成任务与建议优先级

以下顺序是后续执行建议，不是已经完成的事项。每次选择一项可验收的闭环，不连续堆积未经原版验证的模拟能力。

| 优先级 / 任务 | 具体工作 | 完成标准 |
| --- | --- | --- |
| P0 工作区收口 | 审阅并提交当前 17 个暂存文件及交接资料，核对远端 | 变更范围清晰、临时资源未入库、远端提交验证成功 |
| P1 原版对照基线 | 记录可重复的队伍、等级、技能、敌人和操作过程；区分目测、配置、假设 | 至少一条相同前置条件的原版与本地录像/事件对照，差异可定位 |
| P1 嘲讽闭环 | 核实英雄 31 的减伤属性符号、`attackNotCtrl`、来源失效、手动操作、打断规则 | 明确原版证据及适配规则，补有意义的测试和桌面/移动验证 |
| P1 伤害及能量基线 | 防御、暴击、减伤、取整、周期属性快照、回血基数、能量获取时机 | 一组受控案例可解释伤害与能量差异，假设不冒充原版事实 |
| P1 首段端到端还原 | 手动/自动切换、紧凑阵型、路线恢复、首 Boss 阶段和表现 | 从规定初始存档到首 Boss 奖励的可重复流程，并记录原版剩余差异 |
| P2 技能与 Boss 审计 | 按首图和可部署队伍优先处理特殊选择器、条件修饰、召唤、分身、变身、死亡触发、随机布局、血条层等 | 每项从配置到核心、表现、验证、审计记录闭环；不能只删除告警 |
| P2 美术与表现 | 缺失角色/物件资源去重、英雄动作和特效、总览样式、光照范围及转向、前景对齐、音效 | 明确本地素材覆盖，桌面/移动无缺失与错位，建立正式资源清单 |
| P2 后续主线和成长 | 后续世界、长路线、其他模式条件、`RepeatRand` 奖励、碎片、重复卡转化、升星、愿望单等 | 按主线依赖顺序实现，正常资源与命令可以推进，不靠直接改完成标记 |
| P2 战斗存档 | 敌人血量、活动 Buff、施法/冷却、独立技能资源与战斗中断恢复 | 重载行为有明确产品规则，重复奖励与非法状态有覆盖 |
| P3 正式宿主接入 | 确定宿主入口与资源发布方式，接真实角色、协议、结算及重连 | 在目标宿主完整启动与网络链路下验收，保留回退方式 |
| P3 发布验收 | 微信真机、兼容性、内存、长时间战斗、反复进出和重开、资源授权或替换 | 有设备、时间、性能指标与实际报告，不能用桌面截图替代 |

正式协议号、服务器结算合同和发布素材权利等信息不存在时，记录具体外部依赖，继续不依赖它的本地工作，不自行编造接口。

## 7. 下一位 AI 推荐立即执行的步骤

1. 阅读 `AGENTS.md`、本文件、`docs/replica-requirements.md` 和 `docs/local-reference-preview.md` 的最新段落。
2. 核对 Git 暂存区和验证文件是否仍对应当前代码；若期间没有行为修改，不必只为文档反复运行完整构建。
3. 收口已授权的目标 Buff / 嘲讽提交，推送后验证远端；不能混入资源缓存或别人的改动。
4. 读取最新 `audit.json`，优先选择英雄 31 嘲讽闭环或首段流程中影响最大的一个差异。
5. 查看原版当前状态，记录技能或操作的可重复证据。已经授权观察和操控，但不要为了取证擅自进行付费或不可恢复的账号操作。
6. 修改自有适配器和核心，保留仍未确认的审计项；同时检查表现与清理逻辑。
7. 按第 10 节运行相关验证；更新本文件及详细记录的日期、状态、证据和未完成项，再交付该批结果。

如果原版暂时不可观察，可先做审计分类、缺失美术去重、明确的配置适配及本地回归；不能把缺失观察结果补写成已验证事实。

## 8. 代码和文档导航

下列路径均相对仓库根目录。

| 路径 | 职责 |
| --- | --- |
| `assets/scripts/core/demo/DemoSession.ts` | 会话、地图、队伍、战斗、成长及交互协调 |
| `assets/scripts/core/actor/Actor.ts` | 属性、状态、资源、伤害、控制及来源 |
| `assets/scripts/core/combat/Combat.ts` | 施法生命周期、选择目标、命中、弹道、区域和取消 |
| `assets/scripts/core/combat/SkillEffects.ts` | 技能动作、条件和数据合同 |
| `assets/scripts/core/ai/` | 玩家、敌人及 Boss 行为 |
| `assets/scripts/core/world/` | 世界、出生、条件、主线、英雄、成长、招募 |
| `assets/scripts/core/navigation/`、`fog/`、`squad/` | 寻路、迷雾和阵型 |
| `assets/scripts/presentation/` | 原版资源展示、独立展示、迷雾、总览、成长和队伍 UI |
| `assets/scripts/app/DemoBootstrap.ts` | 场景启动和输入接入 |
| `assets/scripts/framework/` | 固定步长、运行时生命周期、宿主接口及服务适配 |
| `tools/reference-cache.mjs` | 缓存索引、资源与表读取、补充资源边界 |
| `tools/build-reference-profile.mjs` | 参考地图和运行配置生成、审计汇总 |
| `tools/reference-skills.mjs` | 原版技能到自有技能合同的转换和审计 |
| `tools/reference-rules.mjs` 等 | 地图、成长、队伍、招募等配置适配 |
| `tools/stage-reference-cache.mjs` | 本地参考资源和配置暂存 |
| `tests/` | 核心与工具测试；不依赖运行中的原版游戏 |
| `tools/reference-*-smoke.mjs` | 分机制源配置验证及参考浏览器验证 |
| `docs/local-reference-preview.md` | 最详细的适配边界和逐批验证记录 |
| `docs/replica-requirements.md` | 最终范围与原版还原缺口 |
| `docs/zhushen-integration.md` | 宿主导出、服务和隔离验证 |
| `docs/acceptance-checklist.md` | 早期灰盒验收清单；不是完整复刻完成表 |

核心必须保持纯 TypeScript，不引入 Cocos、DOM、网络或存储依赖。宿主服务通过 ports 接入，不让战斗代码直接调用旧项目管理器。

## 9. 本机环境和资源路径

| 用途 | 路径或地址 |
| --- | --- |
| Creator | `C:\ProgramData\cocos\editors\Creator\2.4.15\CocosCreator.exe` |
| 自定义引擎 | `D:\group\zss_custom_engine\engine`，沿用现有配置，不修改 |
| Node | 本机验证使用 24.18.1；项目声明至少 20，工具还需相应运行能力 |
| Chrome | `C:\Program Files\Google\Chrome\Application\chrome.exe` |
| Python | `C:\Users\Administrator\AppData\Local\Programs\Python\Python310\python.exe` |
| 源宿主 / Spine | `D:\group\zhushen\client` / `D:\group\zhushen\spine` |
| 隔离宿主 | `temp/zhushen-runtime-checked` |
| 参考页面 | `http://127.0.0.1:4174/?reference=1` |
| 独立示例页面 | `http://127.0.0.1:4174/` |
| 隔离宿主页面 | `http://127.0.0.1:4175/?reference=1` |

用户提供的只读缓存：

```text
C:\Users\Administrator\AppData\Roaming\Tencent\xwechat\radium\Applet\9d2679250b196f1b00a7071d9961ea7c\local\wxd53170210eef737f\usr\gamecaches
```

补充下载保存在 `reference-private/downloads`。如需补充指定资源，沿用 `fetch-reference-map.mjs` / `fetch-reference-atlas.mjs` 的配置一致性验证，不进行无边界抓取。已使用的资源基址为 `https://ymzxr-cn-res.lansors.com/ymzxr_minigame_prod_res/`。

`build`、`library`、`local`、`temp`、`reference-private` 及转换表属于本机生成或临时内容。新机器只有 Git 代码时，不会自动拥有这些资源和既有验证报告。

## 10. 构建与验证操作

下面命令均在仓库根目录的 PowerShell 执行。先检查现有端口和进程；不要无条件关闭已有服务。构建与资源暂存逐个执行，构建期间不要同时编辑场景和资源。

### 10.1 核心测试和指定源配置验证

```powershell
npm test
node --no-warnings --loader ./tests/ts-loader.mjs tools/reference-taunt-smoke.mjs
node --no-warnings --loader ./tests/ts-loader.mjs tools/reference-journal-smoke.mjs
```

两个源配置脚本默认读 `build/web-mobile/reference-preview/profile.json`，也可以传入配置路径。它们需要先生成参考配置。其他机制使用对应的 `reference-*-smoke.mjs`，按变更选择，避免无目的重跑全部脚本。

### 10.2 Creator 构建独立项目

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path temp | Out-Null
$astraBuild = Start-Process -FilePath 'C:\ProgramData\cocos\editors\Creator\2.4.15\CocosCreator.exe' -ArgumentList @('--path', '"C:\Users\Administrator\Desktop\code\ai\game\client"', '--build', '"platform=web-mobile;debug=true;buildPath=build;startScene=4f4a64ba-b67f-4aa1-a7f2-a8d908ff0075"', '--force') -WindowStyle Hidden -RedirectStandardOutput 'temp\build-handoff.log' -RedirectStandardError 'temp\build-handoff.err.log' -PassThru
```

轮询该进程并阅读日志，确认结束和构建结果后再继续。不要把成功启动进程当成构建完成。入口是 `assets/scenes/demo.fire`；隔离宿主使用生成的 `host_probe.fire`，准备器复用该场景 UUID。

### 10.3 重新暂存参考内容

Creator 构建会清理参考输出，因此每次构建后必须重新暂存：

```powershell
node tools/stage-reference-cache.mjs --cache 'C:\Users\Administrator\AppData\Roaming\Tencent\xwechat\radium\Applet\9d2679250b196f1b00a7071d9961ea7c\local\wxd53170210eef737f\usr\gamecaches'
```

检查生成的 `profile.json`、`tables.json`、`audit.json`。读取最新原版表时使用此处的 `tables.json`；旧 `reference-private/reference-tables.json` 可能过期，暂存器不会刷新它。

### 10.4 本地服务和浏览器回归

4174 空闲时可以启动：

```powershell
Start-Process -FilePath 'C:\Users\Administrator\AppData\Local\Programs\Python\Python310\python.exe' -ArgumentList @('-m', 'http.server', '4174', '--bind', '127.0.0.1', '--directory', 'build/web-mobile') -WindowStyle Hidden
```

端口占用时先确认是否已是本项目服务；否则选择新端口并同步测试 URL。

```powershell
node tools/reference-smoke.mjs 'http://127.0.0.1:4174/?reference=1'
node tools/cdp-smoke.mjs 'http://127.0.0.1:4174/'
```

两个脚本分别输出 `temp/qa-reference/report.json` 和 `temp/qa/report.json` 及截图。查看桌面、移动截图和控制台/资源错误。脚本使用固定 CDP 端口 9339 与 9337，不要并发运行同一个脚本。

`npm run smoke:web` 默认端口为 4173；本机目前使用 4174，所以以上命令显式传 URL。参考模式仅允许 localhost。

### 10.5 隔离宿主验证

```powershell
node tools/export-zhushen-module.mjs --out temp/zhushen-module --verify-host D:\group\zhushen\client
node tools/check-zhushen-host.mjs temp/zhushen-module D:\group\zhushen\client
node tools/prepare-zhushen-runtime.mjs --host D:\group\zhushen\client --spine D:\group\zhushen\spine
```

然后使用 Creator 构建 `temp/zhushen-runtime-checked`，沿用上述场景 UUID，将构建日志写入另一个文件。构建结束后：

```powershell
node tools/stage-reference-cache.mjs --cache 'C:\Users\Administrator\AppData\Roaming\Tencent\xwechat\radium\Applet\9d2679250b196f1b00a7071d9961ea7c\local\wxd53170210eef737f\usr\gamecaches' --out temp/zhushen-runtime-checked/build/web-mobile/reference-preview
```

将隔离宿主 `build/web-mobile` 目录服务到 4175 或其他空闲端口，然后执行：

```powershell
node tools/zhushen-runtime-smoke.mjs 'http://127.0.0.1:4175/?reference=1'
node tools/verify-zhushen-runtime.mjs temp/zhushen-runtime-checked
```

模块类型检查零错误与宿主其他诊断分别报告。源文件校验失败时先定位差异，不自动回退或覆盖原工程。

## 11. 最新已完成的验证证据

以下是本次接手在暂存差异审查及修复后的当前验证结果。两套浏览器探针须串行运行；并发启动会争用本机 CDP 初始化。

| 验证 | 已记录结果 | 本机证据 |
| --- | --- | --- |
| 自动测试 | 252 通过，0 失败 | `temp/test-taunt-reviewed.log` |
| 参考浏览器 | 嘲讽、资源、交互、桌面/移动验证；errors 和 failures 均为空 | `temp/qa-reference/report.json` |
| 独立示例 | 浏览器回归通过 | `temp/qa/report.json` |
| 嘲讽展示 | 三个目标受控、取消战术、普攻施加者、到期恢复；英雄 31 资源及重载检查 | `temp/qa-reference/mobile-taunt.png`、`desktop-taunt.png` |
| 主线流程 | 九步骤，202.4 模拟秒，三人生存，324 招募券；没有传送及战斗属性覆盖 | `temp/journal-taunt.log` |
| 隔离宿主 | 角色隔离、缓存重开、关闭竞态及两个视口通过；errors/external/requests 为空 | `temp/host-taunt-reviewed.log` |
| 宿主类型与来源 | 模块零错误，其他宿主既有诊断 17；3558 个原始源码文件哈希一致 | `docs/local-reference-preview.md` 最新验证段、`docs/zhushen-integration.md` |
| Creator | 独立及隔离宿主构建通过 | `temp/build-handoff-current.log`、`temp/build-host-current.log` |

部分浏览器探针会发放测试卡片、材料、段位或构造受击单位来覆盖机制。它们是受控案例，不证明玩家能自然获得相同队伍与材料。主线“自然流程”也是明确的本地比较预设，不是原版账号录像或原版耗时测量。

## 12. 已知假设和容易重复踩的坑

- 比较预设从世界等级 1、段位 1、20 香火、已修复出生传送点、出生迷雾已开开始；英雄用源表等级 10 属性，主线从教程回城之后开始。它不是用户真实账号，也不是从零复刻完整新手流程。
- 不能把 `Actor.targetId` 同时当追击与施法目标。此前这种耦合导致主线通关失败；施法使用独立目标身份。
- 相同帧的目标组缓存与每颗主追踪弹道的目标组隔离都必须保留；死亡不能自动换新目标。
- 源职业 ID 1/2/3/4 对应坦克/近战/辅助/远程；职业优先序是坦克、近战、远程、辅助，不要按 ID 直接排序。
- 默认比较队伍仍使用 `hero_guard` 等固定运行 ID。按源英雄 ID 找演员时通过 `config.roster.heroes.sourceId` 映射，不拼接猜测 ID。
- `Actor.recoverAt` 不改出生中心；复用测试演员时留意返回中心逻辑。
- 原版表有多个后缀分表及字段内 `$id` 别名。使用现有读取器和 `tableRow(table, id)`，不要临时字符串拼接或硬编码当前最大等级。
- 核心代码不要使用宿主 TypeScript lib 不支持的 `Array.flatMap`；Node 工具不受相同限制。
- 独立页面的 `resume_wait` 很短，截图延迟可能越过时间窗口。保留现有浏览器探针的模拟时钟暂停采样，不将采样超时误报为业务回归。
- 嘲讽来源失效后的强制目标与技能限制、英雄 31 的物理修饰符符号、`attackNotCtrl`、回血基数、恐惧间隔、击飞曲线等仍有假设，见审计和详细文档。
- `apply_patch` 新增文件前先检查是否已存在，避免覆盖已有测试。只追加或精确修改需要的范围。
- 临时目录和报告可能清理或重建。历史 PASS 不能证明修改后的代码，也不能证明另一个机器上的环境。

## 13. 后续每批交付的记录格式

每一批至少记录：解决的具体差异、触及文件、原版/配置/假设的依据、运行过的测试和结果、查看过的截图、剩余风险、提交与远端状态、下一项明确工作。

维护以下三层状态：

1. **已实现**：代码中存在所需行为。
2. **已验证**：有明确条件下的测试、运行和可读证据。
3. **原版一致**：相同或可解释前置条件下，有原版对照证据支持。

只有符合第三层的具体事项才能标注为原版还原完成。最终交付还必须覆盖其他世界和流程、正式资源、宿主完整运行及目标设备验收。
