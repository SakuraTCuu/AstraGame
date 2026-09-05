import { LayerManager } from "../../comm/manager/LayerManager";
import { StorageMgr } from "../../comm/manager/StorageMgr";
import { MassloaderManager } from "../../comm/manager/MassloaderManager";
import { TimerManager } from "../../comm/manager/TimerManager";
import { ResourceManager } from "../../comm/manager/ResourceManager";
import { EventDispatcherManager } from "../../comm/manager/EventDispatcherManager";
import { UIManager } from "../../comm/manager/UIManager";
import { SDKManager } from "../../comm/sdk/SDKManager";
import { BaseUI } from "../../comm/view/BaseUI";
import { MessageCenter, MSG } from "../../comm/util/MessageCenter";
import "../../comm/util/NodeExt";
import { ASTRA_EXPLORE_VIEW } from "./AstraExploreView";
import { createLocalDemoPorts } from "./framework/LocalDemoPorts";

const { ccclass } = cc._decorator;

@ccclass("AstraHostProbe")
export class AstraHostProbe extends cc.Component {
    private role = "A";
    private currentConfig: any = ASTRA_EXPLORE_VIEW;
    private cachedConfig = { ...ASTRA_EXPLORE_VIEW, name: "ASTRA_CACHED_PROBE", nodeCacheSeconds: 30 };
    private openCount = 0;
    private telemetryCount = 0;
    private releaseConfig: (() => void) = null;
    private launcher: cc.Node;
    private lastView: any = null;
    private lastRuntime: any = null;
    private configId = "default";

    onLoad(): void {
        cc.debug.setDisplayStats(false);
        LayerManager.instance || this.node.getComponent(LayerManager).init();
        for (const type of [StorageMgr, MassloaderManager, TimerManager, ResourceManager, EventDispatcherManager, SDKManager, UIManager]) {
            const component: any = this.node.addComponent(type as any);
            component.init();
        }
        StorageMgr.instance.setRoleKey(this.scope(this.role));
        MessageCenter.addObserver(this);
        (window as any).__astraHostProbe = this;
        this.makeLauncher();
        this.scheduleOnce(() => { void this.open(); });
    }

    update(delta: number): void {
        TimerManager.instance.updateFrame(delta);
        if (this.launcher) this.launcher.active = !UIManager.instance.getUIView(this.currentConfig);
    }

    open(cached = false, delayed = false): Promise<any> {
        this.currentConfig = cached ? this.cachedConfig : ASTRA_EXPLORE_VIEW;
        const existing = UIManager.instance.getUIView(this.currentConfig);
        if (existing) return Promise.resolve(existing);
        const base = createLocalDemoPorts().config;
        const options: any = { roleKey: this.scope(this.role), config: { load: async (path: string) => {
            const source: any = await base.load(path);
            this.configId = source.meta?.id || "default";
            const config = { ...source, session: { ...source.session, persistExploration: true } };
            if (!delayed) return config;
            return new Promise((resolve) => { this.releaseConfig = () => { this.releaseConfig = null; resolve(config); }; });
        } } };
        return new Promise((resolve) => UIManager.instance.show(this.currentConfig, null, (view) => {
            this.openCount++; this.lastView = view; resolve(view);
        }, options));
    }

    close(): void { this.lastRuntime = this.lastView?.explore?.runtime; UIManager.instance.close(this.currentConfig); }
    setRole(role: string): void { this.role = role; StorageMgr.instance.setRoleKey(this.scope(role)); }
    resolveConfig(): void { if (this.releaseConfig) this.releaseConfig(); }

    getState(): any {
        const view: any = UIManager.instance.getUIView(this.currentConfig);
        const observed = view || (cc.isValid(this.lastView) ? this.lastView : null);
        const session = observed?.explore?.session;
        const renderer = observed?.explore?.renderer;
        return { open: Boolean(view), baseUI: observed instanceof BaseUI, active: Boolean(view?.node.activeInHierarchy), viewId: observed?.node.uuid,
            openCount: this.openCount, telemetryCount: this.telemetryCount, role: this.role, delayed: Boolean(this.releaseConfig),
            state: session?.runState, elapsed: session?.world.elapsedSeconds, contentChildren: observed?.content?.childrenCount,
            closedRuntimeState: this.lastRuntime?.state, contentId: observed?.content?.uuid,
            runtimeState: observed?.explore?.runtime?.state,
            artReady: Boolean(session && renderer?.softFogReady && (!renderer.referenceArt || session.world.players.every((actor) => !actor.alive || renderer.referenceArt.hasActor(actor.id)))),
            profiler: cc.debug.isDisplayStats(),
            design: cc.view.getDesignResolutionSize(), visible: cc.view.getVisibleSize(),
            backButton: Boolean(view?.content?.getChildByName("HostBackButton")),
            services: { ui: UIManager.instance.constructor.name, storage: StorageMgr.instance.constructor.name,
                resources: ResourceManager.instance.constructor.name, layers: LayerManager.instance.constructor.name } };
    }

    readProgress(role: string): any {
        return StorageMgr.instance.getObject(`astra.exploration.progress.v1:${encodeURIComponent(this.configId)}${this.scope(role)}`, null, false);
    }

    private scope(role: string): string { return `_astra_host_probe_${role}`; }

    @MSG("auto_explore:explore_started")
    private onExploreStarted(): void { this.telemetryCount++; }

    private makeLauncher(): void {
        this.launcher = new cc.Node("HostLauncher"); LayerManager.instance.sceneLayer.addChild(this.launcher);
        this.launcher.setContentSize(96, 96);
        const g = this.launcher.addComponent(cc.Graphics); g.fillColor = cc.color(38, 76, 60); g.circle(0, 0, 42); g.fill();
        g.fillColor = cc.color(216, 232, 212); g.moveTo(-9, 20); g.lineTo(21, 0); g.lineTo(-9, -20); g.close(); g.fill();
        this.launcher.on(cc.Node.EventType.TOUCH_END, () => { void this.open(); }, this);
    }

    onDestroy(): void {
        MessageCenter.removeObserver(this);
        if ((window as any).__astraHostProbe === this) delete (window as any).__astraHostProbe;
    }
}
