import { BaseUI } from "../../comm/view/BaseUI";
import { UIManager } from "../../comm/manager/UIManager";
import { StorageMgr } from "../../comm/manager/StorageMgr";
import { MessageCenter } from "../../comm/util/MessageCenter";
import { LayerConstant } from "../../comm/constant/LayerConstant";
import { ObjectProxy } from "../../comm/commodules/object/ObjectProxy";
import { StringUtil } from "../../comm/util/StringUtil";
import DemoBootstrap from "./app/DemoBootstrap";
import { createLocalDemoPorts } from "./framework/LocalDemoPorts";
import { createZhushenPorts } from "./framework/ZhushenPorts";
import { requireRuntimeProtocol, RuntimeConfigPort, RuntimeProtocolPort } from "./framework/RuntimePorts";
import { ResultSubmissionState } from "./framework/ExploreRuntime";

const { ccclass } = cc._decorator;

interface AstraExploreBaseOptions {
    config?: RuntimeConfigPort;
    protocol: RuntimeProtocolPort;
    configPath?: string;
    roleKey?: string;
}
export type AstraExploreOptions = AstraExploreBaseOptions;

export const ASTRA_EXPLORE_VIEW = {
    name: "ASTRA_EXPLORE_VIEW",
    className: "AstraExploreView",
    url: "auto_explore/ExploreView",
    layer: LayerConstant.LAYER_DIALOG,
    isCanBacked: true,
    isAutoClose: true,
    isFullScreen: true,
    isHideMainBottom: true,
    isHideMainTop: true,
    isShowLoading: true,
    depAsset: [{ url: "config/auto_explore/world_demo", className: cc.JsonAsset }],
};

@ccclass("AstraExploreView")
export class AstraExploreView extends BaseUI {
    private content: cc.Node = null;
    private explore: DemoBootstrap = null;
    private backdrop: cc.Graphics = null;
    private fittedWidth = 0;
    private fittedHeight = 0;
    private roleKey: string = null;
    private openOptions: AstraExploreOptions = null;

    public enter(...args: any[]): void {
        const options: AstraExploreOptions = args[0] || this.openOptions;
        if (!options) throw new Error("Exploration requires protocol options");
        const protocol = requireRuntimeProtocol(options.protocol);
        const role = ObjectProxy.instance.getRoleVo();
        const roleKey = args[0]?.roleKey ?? (role && role.srv_id && role.rid ? StringUtil.getNorKey(role.reg_time, role.srv_id, role.rid) : this.roleKey || options.roleKey);
        if (typeof roleKey !== "string" || !roleKey) throw new Error("Exploration requires an active role");
        if (this.explore && this.roleKey !== roleKey) this.releaseContent();
        super.enter(...args);
        if (this.explore) { this.explore.resume(); return; }
        this.roleKey = roleKey;
        this.openOptions = options;
        if (!this.node.getComponent(cc.BlockInputEvents)) this.node.addComponent(cc.BlockInputEvents);
        this.backdrop = this.backdrop || this.node.addComponent(cc.Graphics);
        this.content = new cc.Node("ExploreContent");
        this.content.active = false;
        this.content.setContentSize(720, 1280);
        this.node.addChild(this.content);
        this.explore = this.content.addComponent(DemoBootstrap);
        this.explore.autoStart = false;
        this.explore.manageResolution = false;
        this.content.active = true;
        this.addBackButton();
        this.fitContent();
        void this.explore.open(createZhushenPorts({
            config: options.config || createLocalDemoPorts().config,
            protocol,
            storage: StorageMgr.instance,
            roleKey,
            messages: MessageCenter,
        }), options.configPath || "config/auto_explore/world_demo");
    }

    public update(): void { if (this.content) this.fitContent(); }

    public getResultState(): ResultSubmissionState { return this.explore ? this.explore.resultState : "idle"; }
    public getPendingResult(): Readonly<{ runId: string; sequence: number }> | null { return this.explore ? this.explore.pendingResult : null; }
    public retryPendingResult(): Promise<void> { return this.explore ? this.explore.retryPendingResult() : Promise.resolve(); }

    public exit(...args: any[]): void {
        if (this.explore) this.explore.pause();
        super.exit(...args);
    }

    public dispose(force: boolean = true): void {
        if (force) this.releaseContent();
        else if (this.explore) this.explore.pause();
        super.dispose(force);
    }

    private releaseContent(): void {
        if (this.explore) this.explore.close();
        if (this.content) { this.content.active = false; this.content.destroy(); }
        this.content = null; this.explore = null;
        this.fittedWidth = this.fittedHeight = 0;
    }

    private addBackButton(): void {
        const node = new cc.Node("HostBackButton"); this.content.addChild(node); node.zIndex = 1000;
        node.setPosition(-218, -555); node.setContentSize(64, 64);
        const g = node.addComponent(cc.Graphics); g.fillColor = cc.color(24, 46, 39, 240); g.circle(0, 0, 30); g.fill();
        g.strokeColor = cc.color(220, 234, 212); g.lineWidth = 3; g.circle(0, 0, 30); g.stroke();
        g.moveTo(8, 13); g.lineTo(-7, 0); g.lineTo(8, -13); g.stroke();
        const hint = new cc.Node("BackHint"); node.addChild(hint); hint.setPosition(0, 46); hint.setContentSize(90, 32);
        const label = hint.addComponent(cc.Label); label.string = "\u8fd4\u56de"; label.fontSize = 18; label.lineHeight = 24;
        label.horizontalAlign = cc.Label.HorizontalAlign.CENTER; hint.active = false;
        node.on(cc.Node.EventType.MOUSE_ENTER, () => { hint.active = true; }, this);
        node.on(cc.Node.EventType.MOUSE_LEAVE, () => { hint.active = false; }, this);
        node.on(cc.Node.EventType.TOUCH_END, (event: cc.Event.EventTouch) => { event.stopPropagation(); this.closeSelf(); }, this);
    }

    private fitContent(): void {
        const size = cc.view.getVisibleSize();
        if (this.fittedWidth === size.width && this.fittedHeight === size.height) return;
        this.fittedWidth = size.width;
        this.fittedHeight = size.height;
        this.node.setContentSize(size);
        this.content.setScale(Math.min(size.width / 720, size.height / 1280));
        this.backdrop.clear();
        this.backdrop.fillColor = cc.color(7, 17, 21);
        this.backdrop.rect(-size.width / 2, -size.height / 2, size.width, size.height);
        this.backdrop.fill();
    }
}

export function openAstraExplore(options: AstraExploreOptions): void {
    requireRuntimeProtocol(options && options.protocol);
    UIManager.instance.show(ASTRA_EXPLORE_VIEW, null, null, options);
}
