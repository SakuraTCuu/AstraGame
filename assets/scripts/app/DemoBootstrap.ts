import { DemoConfig, DemoSession } from "../core/demo/DemoSession";
import { DemoRenderer } from "../presentation/DemoRenderer";

const { ccclass } = cc._decorator;
const JOYSTICK_CENTER = cc.v2(0, -470);
const JOYSTICK_RADIUS = 105;

@ccclass
export default class DemoBootstrap extends cc.Component {
    private session: DemoSession = null;
    private renderer: DemoRenderer = null;
    private touchId = -1;
    private touchStart = cc.Vec2.ZERO;
    private touchCurrent = cc.Vec2.ZERO;
    private joystickTouch = false;
    private destroyed = false;

    onLoad(): void {
        cc.view.setDesignResolutionSize(720, 1280, cc.ResolutionPolicy.SHOW_ALL);
        cc.debug.setDisplayStats(false);
        this.renderer = new DemoRenderer(this.node);
        this.bindInput();
        this.loadWorld();
    }

    update(deltaSeconds: number): void {
        if (!this.session || !this.renderer) return;
        this.session.update(Math.min(deltaSeconds, 0.1));
        const snapshot = this.session.getSnapshot();
        this.renderer.pushCombatFeedback(snapshot);
        this.renderer.update(snapshot, deltaSeconds);
    }

    onDestroy(): void {
        this.destroyed = true;
        this.node.off(cc.Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.off(cc.Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.off(cc.Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.off(cc.Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        if (this.renderer) this.renderer.destroy();
        this.renderer = null;
        this.session = null;
    }

    private loadWorld(): void {
        this.renderer.setLoading("LOADING WORLD CONFIG...");
        cc.resources.load("config/auto_explore/world_demo", cc.JsonAsset, (error: Error, asset: cc.JsonAsset) => {
            if (this.destroyed) return;
            if (error || !asset || !asset.json) {
                cc.error("DemoBootstrap failed to load world_demo.json", error);
                this.renderer.setLoading("WORLD CONFIG LOAD FAILED");
                return;
            }
            try {
                const config: any = JSON.parse(JSON.stringify(asset.json));
                // Core combat uses a faction-oriented target contract.
                config.skills.player.target = "enemy";
                config.skills.enemy.target = "enemy";
                this.session = DemoSession.create(config as DemoConfig);
                this.renderer.initialize(config);
                const first = this.session.getSnapshot();
                this.renderer.update(first, 0);
            } catch (initializationError) {
                cc.error("DemoBootstrap failed to initialize demo session", initializationError);
                this.renderer.setLoading("WORLD INITIALIZATION FAILED");
            }
        });
    }

    private bindInput(): void {
        this.node.on(cc.Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(cc.Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.on(cc.Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(cc.Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
    }

    private onTouchStart(event: cc.Event.EventTouch): void {
        if (this.touchId !== -1) return;
        this.touchId = event.getID();
        this.touchStart = this.toCanvas(event);
        this.touchCurrent = this.touchStart;
        this.joystickTouch = this.touchStart.sub(JOYSTICK_CENTER).mag() <= JOYSTICK_RADIUS;
        if (this.joystickTouch) this.applyJoystick(this.touchStart);
    }

    private onTouchMove(event: cc.Event.EventTouch): void {
        if (event.getID() !== this.touchId) return;
        this.touchCurrent = this.toCanvas(event);
        if (this.joystickTouch) this.applyJoystick(this.touchCurrent);
    }

    private onTouchEnd(event: cc.Event.EventTouch): void {
        if (event.getID() !== this.touchId) return;
        const end = this.toCanvas(event);
        if (this.joystickTouch) {
            this.stopJoystick();
        } else if (this.session && end.sub(this.touchStart).mag() < 18 && end.y < 535) {
            const destination = this.renderer.navigationTarget(end);
            if (this.session.setAutoDestination(destination.x, destination.y)) this.renderer.setDestination(destination);
            else this.renderer.rejectDestination();
        }
        this.resetTouch();
    }

    private onTouchCancel(event: cc.Event.EventTouch): void {
        if (event.getID() !== this.touchId) return;
        if (this.joystickTouch) this.stopJoystick();
        this.resetTouch();
    }

    private applyJoystick(position: cc.Vec2): void {
        if (!this.session) return;
        const offset = position.sub(JOYSTICK_CENTER);
        const length = offset.mag();
        const normalized = length > JOYSTICK_RADIUS ? offset.mul(1 / length) : offset.mul(1 / JOYSTICK_RADIUS);
        this.session.setMoveIntent(normalized.x, normalized.y / 0.58);
        this.renderer.setJoystick(normalized, true);
    }

    private stopJoystick(): void {
        if (this.session) this.session.setMoveIntent(0, 0);
        if (this.renderer) this.renderer.setJoystick(cc.Vec2.ZERO, false);
    }

    private resetTouch(): void {
        this.touchId = -1;
        this.joystickTouch = false;
    }

    private toCanvas(event: cc.Event.EventTouch): cc.Vec2 {
        return this.node.convertToNodeSpaceAR(event.getLocation());
    }
}
