import { BaseUI } from "../../comm/view/BaseUI";
import { UIManager } from "../../comm/manager/UIManager";
import { StorageMgr } from "../../comm/manager/StorageMgr";
import { MessageCenter } from "../../comm/util/MessageCenter";
import { LayerConstant } from "../../comm/constant/LayerConstant";
import DemoBootstrap from "./app/DemoBootstrap";
import { createLocalDemoPorts } from "./framework/LocalDemoPorts";
import { createZhushenPorts } from "./framework/ZhushenPorts";
import { RuntimeConfigPort, RuntimeProtocolPort } from "./framework/RuntimePorts";

const { ccclass } = cc._decorator;

export interface AstraExploreOptions {
    config?: RuntimeConfigPort;
    protocol?: RuntimeProtocolPort;
    configPath?: string;
}

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

    public enter(...args: any[]): void {
        super.enter(...args);
        if (this.explore) { this.explore.resume(); return; }
        const options: AstraExploreOptions = args[0] || {};
        if (!this.node.getComponent(cc.BlockInputEvents)) this.node.addComponent(cc.BlockInputEvents);
        this.backdrop = this.node.addComponent(cc.Graphics);
        this.content = new cc.Node("ExploreContent");
        this.content.active = false;
        this.content.setContentSize(720, 1280);
        this.node.addChild(this.content);
        this.explore = this.content.addComponent(DemoBootstrap);
        this.explore.autoStart = false;
        this.explore.manageResolution = false;
        this.content.active = true;
        this.fitContent();
        const local = createLocalDemoPorts();
        void this.explore.open(createZhushenPorts({
            config: options.config || local.config,
            protocol: options.protocol || local.protocol,
            storage: StorageMgr.instance,
            messages: MessageCenter,
        }), options.configPath || "config/auto_explore/world_demo");
    }

    public update(): void { if (this.content) this.fitContent(); }

    public exit(...args: any[]): void {
        if (this.explore) this.explore.pause();
        super.exit(...args);
    }

    public dispose(force: boolean = true): void {
        if (force && this.content) {
            this.content.destroy();
            this.content = null;
            this.explore = null;
        } else if (this.explore) this.explore.pause();
        super.dispose(force);
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

export function openAstraExplore(options: AstraExploreOptions = {}): void {
    UIManager.instance.show(ASTRA_EXPLORE_VIEW, null, null, options);
}
