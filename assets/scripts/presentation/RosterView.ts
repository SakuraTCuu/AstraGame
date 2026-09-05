import type { DemoSnapshot } from "../core/demo/DemoSession";

type Hero = NonNullable<DemoSnapshot["roster"]>["heroes"][number];
export type RosterTab = "lineup" | "recruitment";
export type RosterAction = { kind: "open"; tab: RosterTab } | { kind: "close" } | { kind: "assign"; index: number; heroId: string | null } | { kind: "recruit"; poolId: string; count: number };

export class RosterView {
    readonly node: cc.Node;
    private readonly button: cc.Graphics;
    private readonly panel: cc.Node;
    private readonly frame: cc.Graphics;
    private readonly hint: cc.Label;
    private readonly labels: cc.Label[] = [];
    private readonly portraits: cc.Sprite[] = [];
    private snapshot: DemoSnapshot = null;
    private tab: RosterTab = "lineup";
    private page = 0;
    private pages = 1;
    private ownedOnly = true;
    private rows: Hero[] = [];
    private usedLabels = 0;
    private feedback = "";

    constructor(host: cc.Node) {
        this.node = new cc.Node("RosterView"); this.node.zIndex = 84; host.addChild(this.node);
        const button = new cc.Node("RosterButton"); this.node.addChild(button); this.button = button.addComponent(cc.Graphics);
        this.hint = this.label(button, "RosterHint", 17); this.hint.node.setContentSize(160, 30); this.hint.node.setPosition(-156, 260); this.hint.string = "\u5e03\u9635\u4e0e\u62db\u52df"; this.hint.node.active = false;
        this.panel = new cc.Node("RosterPanel"); this.node.addChild(this.panel); this.panel.zIndex = 10; this.frame = this.panel.addComponent(cc.Graphics); this.panel.active = false;
        for (let index = 0; index < 12; index++) { const node = new cc.Node(`RosterPortrait${index}`); this.panel.addChild(node); const sprite = node.addComponent(cc.Sprite); sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM; this.portraits.push(sprite); }
    }
    get isOpen(): boolean { return this.node.active && this.panel.active; }
    open(tab: RosterTab = "lineup"): void { this.tab = tab; this.page = 0; this.feedback = ""; this.panel.active = true; }
    close(): void { this.panel.active = false; this.hint.node.active = false; this.portraits.forEach((sprite) => { sprite.spriteFrame = null; }); }
    destroy(): void { this.node.destroy(); }
    contains(point: cc.Vec2): boolean { return this.node.active && (this.isOpen || point.sub(cc.v2(-166, 300)).mag() <= 29); }
    hover(point: cc.Vec2 | null): void { this.hint.node.active = Boolean(this.node.active && !this.isOpen && point && point.sub(cc.v2(-166, 300)).mag() <= 29); }
    showResult(success: boolean): void { this.feedback = success ? "" : "\u6761\u4ef6\u672a\u6ee1\u8db3"; }

    hit(point: cc.Vec2): RosterAction | null {
        if (!this.contains(point)) return null;
        if (!this.isOpen) return { kind: "open", tab: "lineup" };
        if (point.sub(cc.v2(306, 557)).mag() <= 30) return { kind: "close" };
        if (point.y >= 456 && point.y <= 513) { this.tab = point.x < 0 ? "lineup" : "recruitment"; this.feedback = ""; return null; }
        if (this.tab === "recruitment") {
            const pool = this.snapshot.recruitment?.pools[0];
            if (pool && point.y >= -578 && point.y <= -519) {
                const count = point.x < 0 ? 1 : 10;
                if (pool.cost.some((cost) => cost.owned < cost.amount * count)) { this.feedback = "\u6750\u6599\u4e0d\u8db3"; return null; }
                return { kind: "recruit", poolId: pool.id, count };
            }
            return null;
        }
        if (Math.abs(point.y + 383) <= 27) { if (point.x < -250) this.page = Math.max(0, this.page - 1); if (point.x > 250) this.page = Math.min(this.pages - 1, this.page + 1); return null; }
        if (point.x < -110 && Math.abs(point.y + 448) <= 25) { this.ownedOnly = !this.ownedOnly; this.page = 0; return null; }
        for (let index = 0; index < this.rows.length; index++) {
            const x = -246 + index % 4 * 164, y = 139 - Math.floor(index / 4) * 166;
            if (Math.abs(point.x - x) > 76 || Math.abs(point.y - y) > 76) continue;
            const hero = this.rows[index];
            if (!hero.owned || !hero.available) { this.feedback = hero.owned ? "\u6682\u4e0d\u53ef\u7528" : "\u672a\u83b7\u5f97"; return null; }
            if (hero.position >= 0) {
                if (this.snapshot.partyIds.length <= 1) { this.feedback = "\u81f3\u5c11\u4e0a\u9635\u4e00\u540d\u9547\u90aa\u4eba"; return null; }
                return { kind: "assign", index: hero.position, heroId: null };
            }
            const slot = this.snapshot.roster.slots.find((slot) => slot.unlocked && !slot.heroId);
            if (!slot) { this.feedback = "\u9635\u5bb9\u5df2\u6ee1"; return null; }
            return { kind: "assign", index: slot.index, heroId: hero.id };
        }
        return null;
    }

    dragAction(from: cc.Vec2, to: cc.Vec2): RosterAction | null {
        if (!this.isOpen || this.tab !== "lineup") return null;
        const source = this.slotAt(from), target = this.slotAt(to);
        const heroId = source !== null && this.snapshot.roster.slots[source].heroId;
        return heroId && target !== null && source !== target ? { kind: "assign", index: target, heroId } : null;
    }

    update(snapshot: DemoSnapshot, icon: (atlas: string, frame: string) => cc.SpriteFrame | null): void {
        this.snapshot = snapshot; this.node.active = Boolean(snapshot.roster);
        if (!this.node.active) return;
        const button = this.button; button.clear(); button.fillColor = cc.color(24, 46, 39); button.circle(-166, 300, 28); button.fill();
        button.strokeColor = cc.color(220, 234, 212); button.lineWidth = 3; button.circle(-166, 300, 28); button.stroke();
        button.circle(-174, 306, 5); button.circle(-158, 306, 5); button.moveTo(-182, 289); button.lineTo(-182, 296); button.lineTo(-166, 300); button.lineTo(-150, 296); button.lineTo(-150, 289); button.stroke();
        if (!this.isOpen) return;
        const g = this.frame; g.clear(); this.usedLabels = 0; this.portraits.forEach((sprite) => { sprite.node.active = false; });
        g.fillColor = cc.color(4, 10, 12, 235); g.rect(-360, -640, 720, 1280); g.fill(); g.fillColor = cc.color(24, 38, 37); g.roundRect(-342, -602, 684, 1204, 6); g.fill();
        g.strokeColor = cc.color(119, 143, 131); g.lineWidth = 2; g.stroke(); this.text("\u9547\u90aa\u5c0f\u961f", 0, 555, 500, 44, 28); this.text("\u00d7", 306, 557, 50, 50, 30);
        for (const [name, x, active] of [["\u5e03\u9635", -160, this.tab === "lineup"], ["\u62db\u52df", 160, this.tab === "recruitment"]] as Array<[string, number, boolean]>) {
            this.text(name, x, 485, 260, 44, 23, active ? cc.color(232, 212, 139) : cc.color(175, 187, 180));
            if (active) { g.fillColor = cc.color(209, 187, 104); g.rect(x - 100, 456, 200, 3); g.fill(); }
        }
        if (this.tab === "lineup") {
            snapshot.roster.slots.forEach((slot, index) => {
                const x = -246 + index % 4 * 164, y = 386 - Math.floor(index / 4) * 92;
                const hero = snapshot.roster.heroes.find((hero) => hero.id === slot.heroId);
                g.fillColor = hero ? cc.color(56, 79, 66) : cc.color(32, 47, 42); g.roundRect(x - 75, y - 38, 150, 76, 4); g.fill();
                const locked = slot.condition && "label" in slot.condition ? slot.condition.label : "\u672a\u89e3\u9501";
                this.text(hero?.name || (slot.unlocked ? "\u7a7a\u4f4d" : locked), x, y, 140, 68, 19, slot.unlocked ? cc.color(226, 235, 227) : cc.color(139, 156, 144));
            });
            const heroes = snapshot.roster.heroes.filter((hero) => !this.ownedOnly || hero.owned).slice().sort((a, b) => Number(b.owned) - Number(a.owned) || (b.quality ?? 0) - (a.quality ?? 0) || a.id.localeCompare(b.id));
            this.pages = Math.max(1, Math.ceil(heroes.length / 12)); this.page = Math.min(this.page, this.pages - 1); this.rows = heroes.slice(this.page * 12, this.page * 12 + 12);
            this.rows.forEach((hero, index) => {
                const x = -246 + index % 4 * 164, y = 139 - Math.floor(index / 4) * 166;
                g.fillColor = hero.owned ? cc.color(47, 64, 56) : cc.color(35, 42, 40); g.roundRect(x - 75, y - 76, 150, 152, 4); g.fill();
                this.portrait(index, hero.icon, x, y + 21, 125, 93, icon);
                this.text(hero.name, x, y - 40, 143, 32, 18);
                this.text(hero.position >= 0 ? "\u5df2\u4e0a\u9635" : !hero.owned ? "\u672a\u83b7\u5f97" : !hero.available ? "\u6682\u4e0d\u53ef\u7528" : `Lv.${hero.level}`, x, y - 64, 142, 25, 16, hero.position >= 0 ? cc.color(146, 227, 164) : cc.color(184, 199, 188));
            });
            if (this.pages > 1) { this.text("<", -290, -383, 50, 40, 26); this.text(">", 290, -383, 50, 40, 26); this.text(`${this.page + 1}/${this.pages}`, 0, -383, 140, 38, 19); }
            g.strokeColor = cc.color(163, 180, 167); g.lineWidth = 2; g.rect(-304, -460, 22, 22); g.stroke();
            if (this.ownedOnly) { g.moveTo(-300, -448); g.lineTo(-293, -455); g.lineTo(-285, -442); g.stroke(); }
            this.text("\u5df2\u83b7\u5f97", -225, -448, 125, 38, 19);
            this.text(`\u51fa\u6218 ${snapshot.partyIds.length}/${snapshot.roster.slots.filter((slot) => slot.unlocked).length}`, 190, -448, 220, 38, 20);
        } else {
            const pool = snapshot.recruitment?.pools[0];
            this.text(pool?.name || "\u6682\u672a\u5f00\u653e", 0, 402, 600, 42, 23);
            if (pool) {
                this.text(pool.cost.map((cost) => `${cost.name} ${cost.owned}`).join("   "), 0, 358, 600, 38, 20);
                if (pool.guaranteeIn !== null) this.text(`\u4fdd\u5e95 ${pool.guaranteeIn}`, 0, 310, 590, 36, 19);
                const draws = snapshot.recruitment.lastDraws.length ? snapshot.recruitment.lastDraws : pool.preview;
                draws.forEach((draw, index) => {
                    const x = -260 + index % 5 * 130, y = 142 - Math.floor(index / 5) * 195;
                    this.portrait(index, draw.icon, x, y + 12, 110, 115, icon); this.text(draw.name, x, y - 75, 124, 58, 17, draw.prize ? cc.color(237, 190, 102) : cc.color(223, 233, 225));
                });
                for (const [count, x] of [[1, -174], [10, 174]]) {
                    const affordable = pool.cost.every((cost) => cost.owned >= cost.amount * count);
                    g.fillColor = affordable ? cc.color(123, 95, 57) : cc.color(47, 57, 54); g.roundRect(x - 130, -578, 260, 60, 4); g.fill();
                    this.text(count === 1 ? "\u62db\u52df\u4e00\u6b21" : "\u62db\u52df\u5341\u6b21", x, -548, 245, 48, 23);
                    this.text(pool.cost.map((cost) => `${cost.amount * count} ${cost.name}`).join("  "), x, -488, 270, 40, 18);
                }
            }
        }
        this.text(this.feedback, 0, this.tab === "lineup" ? -540 : -393, 620, 48, 20, cc.color(238, 168, 134));
        for (let index = this.usedLabels; index < this.labels.length; index++) this.labels[index].node.active = false;
    }

    private slotAt(point: cc.Vec2): number | null { return this.snapshot.roster.slots.find((slot, index) => Math.abs(point.x - (-246 + index % 4 * 164)) <= 75 && Math.abs(point.y - (386 - Math.floor(index / 4) * 92)) <= 38)?.index ?? null; }
    private portrait(index: number, image: { atlas: string; frame: string } | undefined, x: number, y: number, width: number, height: number, load: (atlas: string, frame: string) => cc.SpriteFrame | null): void {
        const frame = image && load(image.atlas, image.frame), sprite = this.portraits[index];
        sprite.spriteFrame = frame || null; sprite.node.active = Boolean(frame);
        if (frame) { const rect = frame.getRect(), scale = Math.min(width / rect.width, height / rect.height); sprite.node.setContentSize(rect.width * scale, rect.height * scale); sprite.node.setPosition(x, y); }
    }
    private text(value: string, x: number, y: number, width: number, height: number, size: number, color = cc.color(226, 235, 227)): void {
        const index = this.usedLabels++, label = this.labels[index] || (this.labels[index] = this.label(this.panel, `RosterText${index}`, size));
        label.node.active = true; label.node.setPosition(x, y); label.node.setContentSize(width, height); label.fontSize = size; label.lineHeight = size + 5; label.node.color = color; label.string = value || "";
    }
    private label(parent: cc.Node, name: string, size: number): cc.Label { const node = new cc.Node(name); parent.addChild(node); const label = node.addComponent(cc.Label); label.fontSize = size; label.lineHeight = size + 5; label.horizontalAlign = cc.Label.HorizontalAlign.CENTER; label.verticalAlign = cc.Label.VerticalAlign.CENTER; label.overflow = cc.Label.Overflow.SHRINK; node.color = cc.color(226, 235, 227); return label; }
}
