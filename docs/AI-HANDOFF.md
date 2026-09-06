# AStraGame 复刻项目：AI 接手执行文档

更新时间：2026-09-07（Asia/Shanghai）。这是当前工作区的交接快照，不是完整复刻验收报告。

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

2026-09-07 核对时：

- 起始 HEAD 为 `a3efbb5fae03c7aa596faf9ec097336de3b9b922`。原有 17 个暂存文件经审查后补了两项嘲讽回归修复，并以本地提交 `77c51ce` 收口。
- 后续配置化战斗、成长、探索、表现及宿主恢复代码以本地提交 `fd221d4` 收口；本文件及其他最新记录在其后单独更新。
- 远端 `origin/main` 已在修改前通过 `git ls-remote` 核对为 `a3efbb5`。推送动作被当前安全审批拒绝，要求用户再次明确确认“推送这些提交到 GitHub `main`”；因此当前只确认本地提交，不能描述为已推送。
- 两个代码提交都未包含 `build`、`library`、`local`、`temp`、`reference-private`、缓存资源、截图或下载文件。
- 原版微信小游戏原生窗口在本轮自动化环境中不可访问，因此新增行为均按“配置合同 + 本地验证”记录，没有补写原版目测结论。

## 4. 当前量化快照与统计口径

以下数字直接来自本地 `build/web-mobile/reference-preview/profile.json` 和 `audit.json`；重新生成后可能变化。

| 项目 | 当前值 | 正确解读 |
| --- | --- | --- |
| 世界 | 诡域秘闻，第一张地图 | 不是全部世界 |
| 所需详细地表 | 844，缺失 0 | 含缩略图共 845 个纹理条目；不代表角色和物件美术全部齐备 |
| 敌人、资源及召唤模板 / 配置出生点 | 137 / 2489 | 新增 1601/1602 两个召唤模板；配置覆盖不等于每个点位都已人工验收 |
| 迷雾区域 / 传送点 | 59 / 31 | 已适配条件；后续模式前置仍有缺口 |
| 额外交互 / 前景遮挡多边形 | 73 / 549 | 仍需扩大原版对照范围 |
| 英雄配置 / 可部署适配 | 44 / 26 | 可部署不代表该英雄所有技能、星级和表现完整 |
| 运行配置技能定义 | 238 | `profile.skills.definitions.length` |
| 源技能编译统计 | 226 | `audit.compiledSkills`，与运行定义采用不同统计入口，不可混用 |
| 技能审计记录 / 类别 | 381 / 53 | 包含未支持、未校准及重复引用；不是 381 个独立同等大小的缺陷 |
| 成长流程审计记录 | 30 | `RepeatRand` 的 23 条问题已清零；其余按条件、奖励与模式逐条处理 |
| 缺失美术记录 | 怪物出生 945、英雄 14、NPC 源直绑 5 | 五个 NPC 已有显式 mapbox08 fallback；怪物记录去重后是 73 个模板 / 51 个 Avatar，三类统计不能相加当作独立素材数 |
| 任务配置 | 156 主线、30 首领首杀、324 段位任务 | 共 510 条配置；目前仅前段流程完成自然通关验证 |

旧文档仍有“23 个可部署英雄”等历史数字，以及早期“宿主运行待验证”的记录。当前以本节快照和最新验证记录为准，历史记录不可当作最新状态。

## 5. 已实现及验证范围

### 5.1 工程、地图、探索

- Cocos Creator 2.4.15 项目，自有 TypeScript 核心逻辑与展示、输入、宿主服务分离。
- 固定 20 Hz 模拟、可控随机、A*、碰撞、手动移动与自动路线切换、阻挡迷雾入口接近及付费后恢复路线；失败改道不会丢失任务意图。
- 第一张原版世界地表、原版碰撞网格映射、可平移缩放总览、目的地选择与已修复传送点移动。
- 原版迷雾条件、等级、段位、累计击杀、任务、NPC 交互及资源消耗；区域手电筒开关、方向光及环境光。
- 角色地面 Y 排序、前景遮挡、身体高度与地面位置分离，支持击飞展示。
- 按配置及宿主角色隔离存档，保存探索、资源、成长、队伍、永久清理和刷新计时等状态。

### 5.2 队伍和成长

- 八个阵位，第五至第八位分别要求段位 4、10、19、28；英雄上阵、下阵、交换、限速追赶、碰撞归队及存活队长切换。
- 角色等级和段位上限、按阵位装备、属性随机及持久化、血量比例保留、替补血量与能量。
- 普通招募券消耗、配置权重、基础保底及存档；显式碎片激活、主线跟踪、导航、奖励领取及首杀奖励。
- `RepeatRand` 使用互斥加权组并保持确定性、原子性和首次掉落幂等；任务界面按“随机一项”展示，不伪装成全部获得。
- 九个主线步骤、首个 Boss、装备及奖励流程已通过自然模拟路径验证，未使用传送或战斗属性覆盖。当前 `1.21` 归队倍率下连续两次为 194.65 模拟秒、四人生存、328 招募券；这是本地确定性结果，不是原版耗时或掉落基线。
- 团灭后回城或回已修复传送点的本地恢复流程已实现，但费用、时间、能量与敌人重置规则尚未与原版完整核实。

### 5.3 战斗

- 普攻、战术与大招的准备、命中、后摇、冷却、共享冷却组、能量与生命复合消耗、独立技能计数资源。
- 多段命中、追踪和方向弹道、扫掠碰撞、总命中预算、重复命中间隔、持续区域、跟随和移动区域、周期治疗及伤害。
- 独立 Buff 和状态计时、周期叠层、部分固有特性、治疗、净化、击退、向指定落点拉拽、击飞、恐惧、定身、沉默、眩晕和冻结。
- 护盾、无敌、不可选中、禁疗、保留一血、单次伤害限制，以及控制、位移和打断免疫的分离。
- 分离追击目标与施法目标；支持最近、最低生命比例、可复现随机、职业优先级和指定攻击属性排序。
- Boss 部分血量阶段、突进、跳跃、多圈预警、错峰落点、移动冲撞、护盾维持施法、破盾后续、寻路回中心及完成后的范围终结技。
- 提交 `77c51ce` 中的嘲讽：强制有效施加者成为普攻目标，限制战术和大招，处理打断、免疫、净化、来源失效及到期恢复。
- 提交 `77c51ce` 中的目标 Buff：同一帧伤害与 Buff 复用接收者组；死亡不补选，数量变化不污染其他动作，每个主追踪弹道分别持有目标组。
- 百分比防御已接入当前临时伤害公式；英雄 11/15 的配置化自身 Buff、英雄 31 的 103124 物理易伤、英雄 12 的向爆炸中心拉拽已接通，空动作技能会保留审计但被禁用，不能白耗资源和冷却。
- 首图 Boss 技能 5001603 可按十个固定偏移召唤 1601/1602，继承施法时有效属性、十秒到期、主人死亡后保留并在自身回位或重置时清理；碰撞重排、取整、回位时机和 501608 表现仍保留 `summon_parity`。

以上是能力列表，不是每个原版英雄和 Boss 的完整实现声明。

### 5.4 诛神宿主

- 模块导出、冲突检查、清单及类型检查已建立。
- 隔离工程实际使用宿主 `UIManager`、`BaseUI`、资源、消息、存储、计时等服务。
- 已验证打开、返回、销毁、缓存重开、角色切换、延迟加载过程中关闭以及保存角色隔离。
- 正式入口不再静默回退离线协议。同角色作用域只有一个活跃 runtime；v2 分阶段回执在同一 JavaScript 进程内跨重启/重开共享进行中的投递，不重复已确认的提交或结算。旧 v1 记录保留但忽略。
- 这不是原工程正式安装，也不是完整登录、联网和重连流程验证。

## 6. 未完成任务与建议优先级

以下顺序是后续执行建议，不是已经完成的事项。每次选择一项可验收的闭环，不连续堆积未经原版验证的模拟能力。

| 优先级 / 任务 | 具体工作 | 完成标准 |
| --- | --- | --- |
| P0 工作区收口 | 本地提交 `77c51ce`、`fd221d4` 及本次文档提交；取得明确推送确认后核对远端 | 本地范围清晰且临时资源未入库；远端成功仍未完成 |
| P1 原版对照基线 | 记录可重复的队伍、等级、技能、敌人和操作过程；区分目测、配置、假设 | 至少一条相同前置条件的原版与本地录像/事件对照，差异可定位 |
| P1 嘲讽闭环 | 103124 物理易伤已按源行接入；继续核实 8 秒配置与 5 秒文案冲突、`attackNotCtrl`、来源失效和手动操作 | 明确原版证据及适配规则，保留有意义的测试和桌面/移动验证 |
| P1 伤害及能量基线 | 百分比防御已接入；继续核实暴击、减伤顺序、取整、周期属性快照、回血基数和能量获取时机 | 一组受控案例可解释伤害与能量差异，假设不冒充原版事实 |
| P1 首段端到端还原 | 本地手动恢复、任务路线、限速紧凑归队和首 Boss 流程已闭环；继续补原版同条件对照与表现差异 | 相同前置条件的原版与本地记录可重复，倍率和随机路径不冒充原版事实 |
| P2 技能与 Boss 审计 | 按首图和可部署队伍优先处理特殊选择器、条件修饰、召唤、分身、变身、死亡触发、随机布局、血条层等 | 每项从配置到核心、表现、验证、审计记录闭环；不能只删除告警 |
| P2 美术与表现 | 五个首图 4048 棺材已用现有 mapbox08 闭环；继续处理缺失角色/物件、英雄动作与特效、总览、光照、前景和音效 | 明确本地素材覆盖，桌面/移动无缺失与错位，建立正式资源清单 |
| P2 后续主线和成长 | `RepeatRand` 和碎片激活已完成；继续处理后续世界、长路线、其他模式、重复卡转化、升星和愿望单 | 按主线依赖顺序实现；属性/技能收益明确前不开放升星消费 |
| P2 战斗存档 | 敌人血量、活动 Buff、施法/冷却、独立技能资源与战斗中断恢复 | 重载行为有明确产品规则，重复奖励与非法状态有覆盖 |
| P3 正式宿主接入 | 确定宿主入口与资源发布方式，接真实角色、协议、结算及重连 | 在目标宿主完整启动与网络链路下验收，保留回退方式 |
| P3 发布验收 | 微信真机、兼容性、内存、长时间战斗、反复进出和重开、资源授权或替换 | 有设备、时间、性能指标与实际报告，不能用桌面截图替代 |

正式协议号、服务器结算合同和发布素材权利等信息不存在时，记录具体外部依赖，继续不依赖它的本地工作，不自行编造接口。

## 7. 下一位 AI 推荐立即执行的步骤

1. 阅读 `AGENTS.md`、本文件、`docs/replica-requirements.md` 和 `docs/local-reference-preview.md` 的最新段落。
2. 核对本地提交、工作区和验证文件；取得用户对 GitHub `main` 推送的再次明确确认后，推送并用 `git ls-remote` 验证远端提交。
3. 原版窗口可访问时，优先记录英雄 31 的 103124 持续时间、`attackNotCtrl`、嘲讽来源失效和手动操作；不要付费或执行不可恢复账号操作。
4. 原版仍不可访问时，从最新 `audit.json` 选择一个配置语义完整的闭环；下一批可继续首图可部署英雄或 5001603 后的 Boss 依赖，不能只删除告警。
5. 升星只先做设计审计：`HeroStar` 成本完整，但属性归属、技能换阶、进行中施法和冷却迁移未确认前，不开放真实碎片消费。
6. 正式宿主接入必须先取得入口、协议号、字段、超时、幂等、奖励和重连合同；不要用离线 probe 代替。
7. 按第 10 节运行相关验证；更新本文件及详细记录的日期、状态、证据和未完成项，再交付下一批。

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
| 自动测试 | 308 通过，0 失败 | `temp/test-client-final-20260907.log` |
| 参考浏览器 | 棺材、碎片激活、嘲讽、资源、交互和桌面/移动完整回归；errors/failures 均为空 | `temp/qa-reference/report.json` |
| 独立示例 | 胜利、全部 Boss 阶段、暂停/重启和 v2 回执结算清理通过；consoleErrors 为空 | `temp/qa/report.json` |
| 棺材及激活表现 | mapbox08 关闭/打开终帧、偏移、一次交互、重载恢复；独立激活按钮、成功反馈和不可上阵防消费 | `temp/qa-reference/coffin-closed.png`、`coffin-open.png`、`fragment-ready.png`、`fragment-activated.png` |
| 主线流程 | 九步骤，194.65 模拟秒，四人生存，328 招募券；没有传送及战斗属性覆盖 | `temp/journal-client-final-20260907-run1.log`、`temp/journal-client-final-20260907-run2.log` |
| 隔离宿主 | 角色 A/B/C 隔离、缓存重开、关闭竞态及两个视口通过；errors/external/requests 为空 | `temp/host-client-final-20260907.log` |
| 宿主类型与来源 | 模块零错误，其他宿主既有诊断 17；3558 个原始源码文件哈希一致，导出篡改/额外文件均为 0 | `temp/zhushen-runtime-checked/source-verification.json` |
| Creator | 独立及隔离宿主最终构建通过 | `temp/build-client-final-20260907.log`、`temp/build-host-final-20260907.log` |

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
- 英雄 31 的 103124 已按源行映射为 20% 物理易伤，但 Buff 行是 8 秒、技能文案是 5 秒；嘲讽来源失效后的技能限制、`attackNotCtrl`、手动操作、回血基数、恐惧间隔和击飞曲线仍有假设。
- `formationCatchUpMultiplier=1.21` 是同时保证独立战役通关和参考首段四人生存的本地确定性调参，不是原版测量值；小幅位置变化会改变沿途击杀和 Boss 结果，测试锁结构合同而非固定掉落数。
- v2 投递台账只保证同一 JavaScript 进程内不重复已确认步骤。进程崩溃、真实网络超时和重连仍要求服务端以 `runId + sequence` 幂等；协议适配器必须有限超时并屏蔽迟到回调。
- `apply_patch` 新增文件前先检查是否已存在，避免覆盖已有测试。只追加或精确修改需要的范围。
- 临时目录和报告可能清理或重建。历史 PASS 不能证明修改后的代码，也不能证明另一个机器上的环境。

## 13. 后续每批交付的记录格式

每一批至少记录：解决的具体差异、触及文件、原版/配置/假设的依据、运行过的测试和结果、查看过的截图、剩余风险、提交与远端状态、下一项明确工作。

维护以下三层状态：

1. **已实现**：代码中存在所需行为。
2. **已验证**：有明确条件下的测试、运行和可读证据。
3. **原版一致**：相同或可解释前置条件下，有原版对照证据支持。

只有符合第三层的具体事项才能标注为原版还原完成。最终交付还必须覆盖其他世界和流程、正式资源、宿主完整运行及目标设备验收。
