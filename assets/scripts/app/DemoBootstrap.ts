import { DemoSession } from "../core/demo/DemoSession";
import { DemoRenderer } from "../presentation/DemoRenderer";
import { ExploreRuntime, SessionReady } from "../framework/ExploreRuntime";
import { createLocalDemoPorts } from "../framework/LocalDemoPorts";
import { RuntimePorts } from "../framework/RuntimePorts";
import type { JournalAction } from "../presentation/ProgressJournalView";
import type { DevelopmentAction } from "../presentation/DevelopmentView";

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
    private resumeAfterOverview = false;
    private resumeAfterJournal = false;
    private journalTouch = false;
    private developmentTouch = false;
    private resumeAfterDevelopment = false;

    get session(): DemoSession { return this.runtime && this.runtime.session; }

    onLoad(): void {
        this.initializeView();
        if (this.autoStart) void this.open();
    }

    async open(ports: RuntimePorts = createLocalDemoPorts(), configPath = "config/auto_explore/world_demo"): Promise<boolean> {
        this.initializeView();
        if (this.runtime) { await this.runtime.flushProgress(); this.runtime.dispose(); }
        this.runtime = new ExploreRuntime(ports);
        this.runtime.events.on("loading", () => this.renderer.setLoading("LOADING WORLD..."));
        this.runtime.events.on<SessionReady>("ready", ({ config, session }) => {
            this.renderer.initialize(config);
            this.renderer.centerOnLeader(session.getSnapshot());
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
        this.node.off(cc.Node.EventType.MOUSE_WHEEL, this.onMouseWheel, this);
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
        this.node.on(cc.Node.EventType.MOUSE_WHEEL, this.onMouseWheel, this);
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
        if (!this.renderer) return;
        const point = this.node.convertToNodeSpaceAR(event.getLocation());
        if (this.renderer.overview.isOpen) this.renderer.overview.hover(point);
        else { this.renderer.setHoveredControl(this.renderer.hitControl(point)); this.renderer.journal.hover(point); this.renderer.development.hover(point); }
    }

    private onMouseLeave(): void { if (this.renderer) { this.renderer.setHoveredControl(null); this.renderer.overview.hover(null); this.renderer.journal.hover(null); this.renderer.development.hover(null); } }
    private onMouseWheel(event: cc.Event.EventMouse): void { if (this.renderer.overview.isOpen) this.renderer.overview.zoom(event.getScrollY() > 0 ? 1 : -1); }

    private onTouchStart(event: cc.Event.EventTouch): void {
        if (this.touchId !== -1) return;
        this.touchId = event.getID();
        this.touchStart = this.toCanvas(event);
        this.touchCurrent = this.touchStart;
        if (this.renderer.overview.isOpen) { this.renderer.overview.beginDrag(this.touchStart); return; }
        this.developmentTouch = this.renderer.development.contains(this.touchStart);
        if (this.developmentTouch) return;
        this.journalTouch = this.renderer.journal.contains(this.touchStart);
        if (this.journalTouch) return;
        this.controlTouch = this.renderer.hitControl(this.touchStart);
        this.joystickTouch = !this.controlTouch && this.touchStart.sub(JOYSTICK_CENTER).mag() <= JOYSTICK_RADIUS;
        this.joystickOrigin = JOYSTICK_CENTER;
        if (this.joystickTouch) this.applyJoystick(this.touchStart);
    }

    private onTouchMove(event: cc.Event.EventTouch): void {
        if (event.getID() !== this.touchId || this.controlTouch || this.journalTouch || this.developmentTouch) return;
        this.touchCurrent = this.toCanvas(event);
        if (this.renderer.overview.isOpen) { if (this.touchStart.y < 470 && this.touchStart.y > -425) this.renderer.overview.drag(this.touchCurrent); return; }
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
        if (this.renderer.overview.isOpen) {
            const action = end.sub(this.touchStart).mag() < 18 ? this.renderer.overview.hit(end) : null;
            if (action) {
                this.renderer.overview.close();
                if (this.resumeAfterOverview) this.resume();
                this.resumeAfterOverview = false;
                if (action.kind === "travel") {
                    if (this.session.teleportToPoi(action.id)) this.renderer.centerOnLeader(this.session.getSnapshot());
                    else this.renderer.showInteractionResult("unavailable");
                } else if (action.kind === "navigate" && !this.session.navigateToPoi(action.id)) this.renderer.rejectDestination();
            }
        } else if (this.developmentTouch) {
            if (end.sub(this.touchStart).mag() < 18) this.handleDevelopmentAction(this.renderer.development.hit(end));
        } else if (this.journalTouch) {
            if (end.sub(this.touchStart).mag() < 18) this.handleJournalAction(this.renderer.journal.hit(end));
        } else if (this.controlTouch) {
            if (this.renderer.hitControl(end) === this.controlTouch) {
                if (this.controlTouch === "restart") void this.restart();
                else if (this.session && this.session.runState === "paused") this.resume();
                else this.pause();
            }
        } else if (this.joystickTouch) {
            this.stopJoystick();
        } else if (this.session && end.sub(this.touchStart).mag() < 18 && end.y < 535) {
            const interaction = this.renderer.hitInteraction(end);
            if (interaction) this.renderer.showInteractionResult(this.session.interactWithPoi(interaction));
            else if (this.renderer.isMinimapPoint(end)) {
                this.resumeAfterOverview = this.session.runState === "running";
                this.pause();
                this.renderer.openOverview(this.session.getSnapshot());
            } else {
                const destination = this.renderer.navigationTarget(end);
                if (this.session.setAutoDestination(destination.x, destination.y)) this.renderer.setDestination(destination);
                else this.renderer.rejectDestination();
            }
        }
        this.resetTouch();
    }

    private handleJournalAction(action: JournalAction | null): void {
        if (!action || !this.session) return;
        if (action.kind === "develop") { this.handleDevelopmentAction({ kind: "open" }); return; }
        if (action.kind === "open") {
            this.resumeAfterJournal = this.session.runState === "running";
            this.pause(); this.renderer.journal.open(action.tab);
        } else if (action.kind === "claim") {
            this.renderer.showInteractionResult(this.session.claimQuest(action.id));
        } else if (action.kind === "promote") {
            const result = this.session.promoteRank();
            this.renderer.showInteractionResult(result === "claimed" ? "promoted" : result);
        } else {
            this.renderer.journal.close();
            if (this.resumeAfterJournal) this.resume();
            this.resumeAfterJournal = false;
            if (action.kind === "navigate" && !this.session.navigateToQuest(action.id)) this.renderer.rejectDestination();
        }
        this.renderer.update(this.session.getSnapshot(), 0);
        void this.runtime.flushProgress();
    }

    private handleDevelopmentAction(action: DevelopmentAction | null): void {
        if (!action || !this.session) return;
        if (action.kind === "open") {
            this.resumeAfterDevelopment = this.session.runState === "running" || this.resumeAfterJournal;
            this.renderer.journal.close(); this.resumeAfterJournal = false;
            this.pause(); this.renderer.development.open();
        } else if (action.kind === "close") {
            this.renderer.development.close();
            if (this.resumeAfterDevelopment) this.resume();
            this.resumeAfterDevelopment = false;
        } else {
            const result = action.kind === "upgrade" ? this.session.upgradeHero(action.actorId) :
                action.kind === "equip" ? this.session.equipItem(action.itemId, action.slotId) : this.session.unequipItem(action.slotId);
            this.renderer.showInteractionResult(result);
        }
        this.renderer.update(this.session.getSnapshot(), 0);
        void this.runtime.flushProgress();
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
        this.journalTouch = false;
        this.developmentTouch = false;
    }

    private toCanvas(event: cc.Event.EventTouch): cc.Vec2 {
        return this.node.convertToNodeSpaceAR(event.getLocation());
    }
}
