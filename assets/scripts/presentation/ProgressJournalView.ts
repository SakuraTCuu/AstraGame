import type { DemoSnapshot } from "../core/demo/DemoSession";

type JournalSnapshot = DemoSnapshot["journal"];
type Quest = JournalSnapshot["quests"][number];
type Tab = "main" | "boss" | "rank";
export type JournalAction = { kind: "open"; tab: Tab } | { kind: "roster"; tab: "lineup" | "recruitment" } | { kind: "close" | "promote" | "develop" } | { kind: "claim" | "navigate"; id: string };

export class ProgressJournalView {
    readonly node: cc.Node;
    private readonly tracker: cc.Graphics;
    private readonly panel: cc.Node;
    private readonly frame: cc.Graphics;
    private readonly trackerTitle: cc.Label;
    private readonly trackerStatus: cc.Label;
    private readonly labels: cc.Label[] = [];
    private readonly hint: cc.Label;
    private snapshot: JournalSnapshot = null;
    private tab: Tab = "main";
    private page = 0;
    private selectedId: string = null;
    private rows: Quest[] = [];
    private tracked: Quest = null;
    private usedLabels = 0;
    private pages = 1;

    constructor(host: cc.Node) {
        this.node = new cc.Node("ProgressJournal"); this.node.zIndex = 79; host.addChild(this.node);
        const tracker = new cc.Node("QuestTracker"); this.node.addChild(tracker); this.tracker = tracker.addComponent(cc.Graphics);
        this.trackerTitle = this.label(tracker, "QuestTitle", 20, -185, 388, 286, 30);
        this.trackerStatus = this.label(tracker, "QuestStatus", 17, -185, 357, 286, 28);
        this.hint = this.label(tracker, "JournalHint", 17, -250, 260, 160, 28); this.hint.node.active = false;
        this.panel = new cc.Node("JournalPanel"); this.panel.zIndex = 90; this.node.addChild(this.panel);
        this.frame = this.panel.addComponent(cc.Graphics);
        this.panel.active = false;
    }

    get isOpen(): boolean { return this.panel.active && this.node.active; }
    open(tab: Tab = "main"): void { this.tab = tab; this.page = 0; this.selectedId = null; this.panel.active = true; }
    close(): void { this.panel.active = false; this.hint.node.active = false; }
    destroy(): void { this.node.destroy(); }
    contains(point: cc.Vec2): boolean { return this.node.active && (this.isOpen || (point.x >= -335 && point.x <= -30 && point.y >= 338 && point.y <= 414) || point.sub(cc.v2(-310, 300)).mag() <= 29); }
    hover(point: cc.Vec2 | null): void {
        this.hint.node.active = Boolean(!this.isOpen && point && point.sub(cc.v2(-310, 300)).mag() <= 29);
        if (this.hint.node.active) this.hint.string = "\u4efb\u52a1\u4e0e\u5934\u8854";
    }

    hit(point: cc.Vec2): JournalAction | null {
        if (!this.node.active) return null;
        if (!this.isOpen) {
            if (point.sub(cc.v2(-310, 300)).mag() <= 29) return { kind: "open", tab: "main" };
            if (!this.contains(point) || !this.tracked) return null;
            if (this.tracked.state === "ready") return { kind: "claim", id: this.tracked.id };
            if (this.tracked.destination?.menu === "development") return { kind: "develop" };
            if (this.tracked.destination?.menu === "lineup" || this.tracked.destination?.menu === "recruitment") return { kind: "roster", tab: this.tracked.destination.menu };
            if (this.tracked.destination && this.tracked.state === "active") return { kind: "navigate", id: this.tracked.id };
            return { kind: "open", tab: this.tracked.condition.kind === "rank" ? "rank" : "main" };
        }
        if (point.sub(cc.v2(306, 557)).mag() <= 30) return { kind: "close" };
        if (point.y >= 454 && point.y <= 514) {
            this.tab = point.x < -108 ? "main" : point.x > 108 ? "rank" : "boss";
            this.page = 0; this.selectedId = null; return null;
        }
        for (let index = 0; index < this.rows.length; index++) if (Math.abs(point.y - (355 - index * 83)) <= 36 && Math.abs(point.x) <= 320) { this.selectedId = this.rows[index].id; return null; }
        if (Math.abs(point.y + 477) <= 27) {
            if (point.x < -250) this.page = Math.max(0, this.page - 1);
            if (point.x > 250) this.page = Math.min(this.pages - 1, this.page + 1);
            this.selectedId = null; return null;
        }
        if (point.y >= -576 && point.y <= -518) {
            if (this.tab === "rank" && point.x < -90 && this.snapshot.rank.next?.ready) return { kind: "promote" };
            const selected = this.snapshot.quests.find((quest) => quest.id === this.selectedId);
            if (!selected || Math.abs(point.x - 135) > 150) return null;
            if (selected.state === "ready") return { kind: "claim", id: selected.id };
            if (selected.state === "active" && selected.destination?.menu === "development") return { kind: "develop" };
            if (selected.state === "active" && (selected.destination?.menu === "lineup" || selected.destination?.menu === "recruitment")) return { kind: "roster", tab: selected.destination.menu };
            if (selected.state === "active" && selected.destination) return { kind: "navigate", id: selected.id };
        }
        return null;
    }

    update(snapshot: DemoSnapshot): void {
        this.snapshot = snapshot.journal;
        this.node.active = Boolean(this.snapshot.quests.length);
        if (!this.node.active) return;
        this.tracked = this.snapshot.quests.find((quest) => quest.category === "main" && (quest.state === "active" || quest.state === "ready")) ||
            this.snapshot.quests.find((quest) => quest.category === "main" && quest.state !== "claimed");
        const g = this.tracker; g.clear();
        g.fillColor = cc.color(18, 34, 31, 205); g.roundRect(-338, 334, 310, 83, 4); g.fill();
        g.fillColor = cc.color(24, 46, 39); g.circle(-310, 300, 28); g.fill();
        g.strokeColor = cc.color(220, 234, 212); g.lineWidth = 3; g.circle(-310, 300, 28); g.stroke();
        g.moveTo(-322, 309); g.lineTo(-298, 309); g.moveTo(-322, 300); g.lineTo(-298, 300); g.moveTo(-322, 291); g.lineTo(-298, 291); g.stroke();
        this.trackerTitle.string = this.tracked?.name || "\u672c\u7ae0\u4efb\u52a1\u5df2\u5b8c\u6210";
        this.trackerStatus.string = this.tracked?.state === "ready" ? "\u9886\u53d6\u5956\u52b1" : this.tracked?.requirements.join("  ") || "";
        this.trackerStatus.node.color = this.tracked?.state === "ready" ? cc.color(137, 222, 159) : cc.color(207, 213, 205);
        if (!this.isOpen) return;
        this.drawPanel();
    }

    private drawPanel(): void {
        const g = this.frame; g.clear(); this.usedLabels = 0;
        g.fillColor = cc.color(4, 10, 12, 235); g.rect(-360, -640, 720, 1280); g.fill();
        g.fillColor = cc.color(24, 38, 37); g.roundRect(-342, -602, 684, 1204, 6); g.fill();
        g.strokeColor = cc.color(119, 143, 131); g.lineWidth = 2; g.stroke();
        this.text("\u9547\u90aa\u5fd7", 0, 555, 500, 44, 28);
        this.text("\u00d7", 306, 557, 50, 50, 30);
        const tabs: Array<[Tab, string, number]> = [["main", "\u4efb\u52a1", -214], ["boss", "\u9996\u9886", 0], ["rank", "\u5934\u8854", 214]];
        for (const [id, name, x] of tabs) {
            this.text(name, x, 484, 190, 46, 23, id === this.tab ? cc.color(232, 212, 139) : cc.color(175, 187, 180));
            if (id === this.tab) { g.fillColor = cc.color(209, 187, 104); g.rect(x - 78, 455, 156, 3); g.fill(); }
        }
        const rank = this.snapshot.rank;
        this.text(this.tab === "rank" ? `${rank.name}  >  ${rank.next?.name || "\u5df2\u8fbe\u6700\u9ad8\u5934\u8854"}` : this.tab === "boss" ? "\u9996\u901a\u5956\u52b1" : "\u5f53\u524d\u4efb\u52a1", 0, 414, 600, 36, 19);
        let items = this.snapshot.quests.filter((quest) => this.tab === "rank" ? rank.next?.questIds.includes(quest.id) : quest.category === this.tab);
        if (this.tab === "main") { const active = items.filter((quest) => quest.state === "active" || quest.state === "ready"); items = active.length ? active : items.filter((quest) => quest.state !== "claimed").slice(0, 1); }
        if (this.tab === "boss") items = items.slice().sort((a, b) => Number(b.state === "ready") - Number(a.state === "ready") || Number(a.state === "claimed") - Number(b.state === "claimed") || (a.order ?? 0) - (b.order ?? 0));
        this.pages = Math.max(1, Math.ceil(items.length / 6)); this.page = Math.min(this.page, this.pages - 1);
        this.rows = items.slice(this.page * 6, this.page * 6 + 6);
        if (!this.rows.some((quest) => quest.id === this.selectedId)) this.selectedId = this.rows[0]?.id || null;
        const stateNames = { locked: "\u672a\u5f00\u653e", active: "\u8fdb\u884c\u4e2d", ready: "\u53ef\u9886\u53d6", claimed: "\u5df2\u9886\u53d6" };
        this.rows.forEach((quest, index) => {
            const y = 355 - index * 83;
            if (quest.id === this.selectedId) { g.fillColor = cc.color(56, 79, 68); g.rect(-326, y - 35, 652, 70); g.fill(); }
            this.text(quest.name, -64, y, 462, 58, 21);
            this.text(stateNames[quest.state], 250, y, 120, 36, 18, quest.state === "ready" ? cc.color(160, 225, 166) : cc.color(180, 193, 185));
        });
        const selected = this.snapshot.quests.find((quest) => quest.id === this.selectedId);
        if (selected) {
            this.text(selected.name, 0, -187, 608, 50, 23);
            this.text(selected.requirements.join("\n") || stateNames[selected.state], 0, -270, 608, 100, 19);
            this.text(selected.rewards.map((reward) => "oneOf" in reward ? `\u968f\u673a\u4e00\u9879\uff1a${reward.oneOf.map((choice) => `${choice.name} ${choice.amount}\uff08${choice.weight}\uff09`).join(" / ")}` :
                `${reward.name} ${reward.amount}`).join("   ") || "", 0, -373, 608, 75, 19, cc.color(225, 207, 151));
            const enabled = selected.state === "ready" || (selected.state === "active" && Boolean(selected.destination));
            g.fillColor = enabled ? cc.color(63, 105, 79) : cc.color(47, 57, 54); g.roundRect(10, -576, 260, 58, 4); g.fill();
            this.text(selected.state === "ready" ? "\u9886\u53d6" : selected.state === "claimed" ? "\u5df2\u9886\u53d6" : "\u524d\u5f80", 140, -547, 230, 48, 23);
        }
        if (this.tab === "rank" && rank.next) {
            g.fillColor = rank.next.ready ? cc.color(148, 96, 62) : cc.color(47, 57, 54); g.roundRect(-294, -576, 250, 58, 4); g.fill();
            this.text("\u664b\u5347", -170, -547, 220, 48, 23);
        }
        if (this.pages > 1) { this.text("<", -286, -477, 56, 45, 27); this.text(">", 286, -477, 56, 45, 27); this.text(`${this.page + 1}/${this.pages}`, 0, -477, 150, 36, 19); }
        for (let index = this.usedLabels; index < this.labels.length; index++) this.labels[index].node.active = false;
    }

    private text(value: string, x: number, y: number, width: number, height: number, size: number, color = cc.color(226, 235, 227)): void {
        const index = this.usedLabels++;
        const label = this.labels[index] || (this.labels[index] = this.label(this.panel, `JournalText${index}`, size, x, y, width, height));
        label.node.active = true; label.node.setPosition(x, y); label.node.setContentSize(width, height); label.fontSize = size; label.lineHeight = size + 6;
        label.node.color = color; label.string = value;
    }
    private label(parent: cc.Node, name: string, size: number, x: number, y: number, width: number, height: number): cc.Label {
        const node = new cc.Node(name); parent.addChild(node); node.setPosition(x, y); node.setContentSize(width, height);
        const label = node.addComponent(cc.Label); label.fontSize = size; label.lineHeight = size + 6; label.horizontalAlign = cc.Label.HorizontalAlign.CENTER;
        label.verticalAlign = cc.Label.VerticalAlign.CENTER; label.overflow = cc.Label.Overflow.SHRINK;
        node.setContentSize(width, height); node.color = cc.color(226, 235, 227); return label;
    }
}
