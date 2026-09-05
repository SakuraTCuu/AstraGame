import { DemoSession } from "../core/demo/DemoSession";
import { DemoRenderer } from "../presentation/DemoRenderer";
import { ExploreRuntime, SessionReady } from "../framework/ExploreRuntime";
import { createLocalDemoPorts } from "../framework/LocalDemoPorts";
import { RuntimePorts } from "../framework/RuntimePorts";

const { ccclass } = cc._decorator;
const JOYSTICK_CENTER = cc.v2(0, -470);
const JOYSTICK_RADIUS = 105;

@ccclass
export default class DemoBootstrap extends cc.Component {
    autoStart = true;
    manageResolution = true;
    private runtime: ExploreRuntime = null;
    private renderer: DemoRenderer = null;
    private touchId = -1;
    private touchStart = cc.Vec2.ZERO;
    private touchCurrent = cc.Vec2.ZERO;
    private joystickOrigin = JOYSTICK_CENTER;
    private joystickTouch = false;
    private controlTouch: "pause" | "restart" | null = null;
    private resumeOnShow = false;

    get session(): DemoSession { return this.runtime && this.runtime.session; }

    onLoad(): void {
        this.initializeView();
        if (this.autoStart) void this.open();
    }

    async open(ports: RuntimePorts = createLocalDemoPorts(), configPath = "config/auto_explore/world_demo"): Promise<boolean> {
        this.initializeView();
        if (this.runtime) this.runtime.dispose();
        this.runtime = new ExploreRuntime(ports);
        this.runtime.events.on("loading", () => this.renderer.setLoading("LOADING WORLD..."));
        this.runtime.events.on<SessionReady>("ready", ({ config, session }) => {
            this.renderer.initialize(config);
            this.renderer.update(session.getSnapshot(), 0);
        });
        this.runtime.events.on<Error>("error", (error) => {
            cc.error("Explore runtime:", error);
            if (!this.session) this.renderer.setLoading("WORLD LOAD FAILED");
        });
        return this.runtime.start(configPath);
    }

    restart(): Promise<boolean> {
        this.stopJoystick();
        return this.runtime ? this.runtime.restart() : Promise.resolve(false);
    }

    pause(): boolean { this.stopJoystick(); return this.runtime ? this.runtime.pause() : false; }
    resume(): boolean { return this.runtime ? this.runtime.resume() : false; }

    update(deltaSeconds: number): void {
        if (!this.runtime || !this.renderer) return;
        const snapshot = this.runtime.update(Math.min(deltaSeconds, 0.1));
        if (!snapshot) return;
        this.renderer.pushCombatFeedback(snapshot);
        this.renderer.update(snapshot, deltaSeconds);
    }

    onDestroy(): void {
        this.node.off(cc.Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.off(cc.Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.off(cc.Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.off(cc.Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        this.node.off(cc.Node.EventType.MOUSE_MOVE, this.onMouseMove, this);
        this.node.off(cc.Node.EventType.MOUSE_LEAVE, this.onMouseLeave, this);
        cc.game.off(cc.game.EVENT_HIDE, this.onGameHide, this);
        cc.game.off(cc.game.EVENT_SHOW, this.onGameShow, this);
        if (this.runtime) this.runtime.dispose();
        if (this.renderer) this.renderer.destroy();
        this.renderer = null;
        this.runtime = null;
    }

    private initializeView(): void {
        if (this.renderer) return;
        if (this.manageResolution) {
            cc.view.setDesignResolutionSize(720, 1280, cc.ResolutionPolicy.SHOW_ALL);
            cc.debug.setDisplayStats(false);
        }
        this.renderer = new DemoRenderer(this.node);
        this.node.on(cc.Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(cc.Node.EventType.TOUCH_MOVE, this.onTouchMove, this);
        this.node.on(cc.Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.node.on(cc.Node.EventType.TOUCH_CANCEL, this.onTouchCancel, this);
        this.node.on(cc.Node.EventType.MOUSE_MOVE, this.onMouseMove, this);
        this.node.on(cc.Node.EventType.MOUSE_LEAVE, this.onMouseLeave, this);
        cc.game.on(cc.game.EVENT_HIDE, this.onGameHide, this);
        cc.game.on(cc.game.EVENT_SHOW, this.onGameShow, this);
    }

    private onGameHide(): void {
        this.resumeOnShow = Boolean(this.session && this.session.runState === "running");
        this.pause();
    }

    private onGameShow(): void {
        if (this.resumeOnShow) this.resume();
        this.resumeOnShow = false;
    }

    private onMouseMove(event: cc.Event.EventMouse): void {
        if (this.renderer) this.renderer.setHoveredControl(this.renderer.hitControl(this.node.convertToNodeSpaceAR(event.getLocation())));
    }

    private onMouseLeave(): void { if (this.renderer) this.renderer.setHoveredControl(null); }

    private onTouchStart(event: cc.Event.EventTouch): void {
        if (this.touchId !== -1) return;
        this.touchId = event.getID();
        this.touchStart = this.toCanvas(event);
        this.touchCurrent = this.touchStart;
        this.controlTouch = this.renderer.hitControl(this.touchStart);
        this.joystickTouch = !this.controlTouch && this.touchStart.sub(JOYSTICK_CENTER).mag() <= JOYSTICK_RADIUS;
        this.joystickOrigin = JOYSTICK_CENTER;
        if (this.joystickTouch) this.applyJoystick(this.touchStart);
    }

    private onTouchMove(event: cc.Event.EventTouch): void {
        if (event.getID() !== this.touchId || this.controlTouch) return;
        this.touchCurrent = this.toCanvas(event);
        if (!this.joystickTouch && this.touchStart.y < 470 && !this.renderer.isMinimapPoint(this.touchStart) &&
            this.touchCurrent.sub(this.touchStart).mag() >= 12) {
            this.joystickTouch = true;
            this.joystickOrigin = this.touchStart;
        }
        if (this.joystickTouch) this.applyJoystick(this.touchCurrent);
    }

    private onTouchEnd(event: cc.Event.EventTouch): void {
        if (event.getID() !== this.touchId) return;
        const end = this.toCanvas(event);
        if (this.controlTouch) {
            if (this.renderer.hitControl(end) === this.controlTouch) {
                if (this.controlTouch === "restart") void this.restart();
                else if (this.session && this.session.runState === "paused") this.resume();
                else this.pause();
            }
        } else if (this.joystickTouch) {
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
        if (!this.session || this.session.runState !== "running") return;
        const offset = position.sub(this.joystickOrigin);
        const length = offset.mag();
        const normalized = length > JOYSTICK_RADIUS ? offset.mul(1 / length) : offset.mul(1 / JOYSTICK_RADIUS);
        this.session.setMoveIntent(normalized.x, normalized.y / 0.58);
        this.renderer.setJoystick(normalized, true, this.joystickOrigin);
    }

    private stopJoystick(): void {
        if (this.session) this.session.setMoveIntent(0, 0);
        if (this.renderer) this.renderer.setJoystick(cc.Vec2.ZERO, false);
    }

    private resetTouch(): void {
        this.touchId = -1;
        this.joystickTouch = false;
        this.controlTouch = null;
    }

    private toCanvas(event: cc.Event.EventTouch): cc.Vec2 {
        return this.node.convertToNodeSpaceAR(event.getLocation());
    }
}
