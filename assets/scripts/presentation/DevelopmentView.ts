import type { DemoSnapshot } from "../core/demo/DemoSession";

type Snapshot = NonNullable<DemoSnapshot["development"]>;
type Item = Snapshot["items"][number];
export type DevelopmentAction = { kind: "open" } | { kind: "close" } | { kind: "upgrade"; actorId: string } | { kind: "equip"; itemId: string; slotId: string } | { kind: "unequip"; slotId: string };

export class DevelopmentView {
    readonly node: cc.Node;
    private readonly button: cc.Graphics;
    private readonly panel: cc.Node;
    private readonly frame: cc.Graphics;
    private readonly hint: cc.Label;
    private readonly labels: cc.Label[] = [];
    private readonly icons: cc.Sprite[] = [];
    private snapshot: Snapshot = null;
    private heroId: string = null;
    private slotId: string = null;
    private itemId: string = null;
    private usedLabels = 0;
    private rows: Item[] = [];
    private page = 0;
    private pages = 1;
    private slots: Snapshot["slots"] = [];

    constructor(host: cc.Node) {
        this.node = new cc.Node("PartyDevelopment"); this.node.zIndex = 82; host.addChild(this.node);
        const button = new cc.Node("DevelopmentButton"); this.node.addChild(button); this.button = button.addComponent(cc.Graphics);
        this.hint = this.label(button, "DevelopmentHint", 17); this.hint.node.setPosition(-226, 260); this.hint.node.setContentSize(160, 30); this.hint.string = "\u9547\u90aa\u4eba"; this.hint.node.active = false;
        this.panel = new cc.Node("DevelopmentPanel"); this.panel.zIndex = 10; this.node.addChild(this.panel); this.frame = this.panel.addComponent(cc.Graphics); this.panel.active = false;
        for (let index = 0; index < 4; index++) {
            const node = new cc.Node(`EquipmentIcon${index}`); this.panel.addChild(node); node.setContentSize(54, 54);
            const sprite = node.addComponent(cc.Sprite); sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM; this.icons.push(sprite);
        }
    }

    get isOpen(): boolean { return this.node.active && this.panel.active; }
    open(): void { this.panel.active = true; this.page = 0; }
    close(): void { this.panel.active = false; this.hint.node.active = false; }
    destroy(): void { this.node.destroy(); }
    contains(point: cc.Vec2): boolean { return this.node.active && (this.isOpen || point.sub(cc.v2(-238, 300)).mag() <= 29); }
    hover(point: cc.Vec2 | null): void { this.hint.node.active = Boolean(this.node.active && !this.isOpen && point && point.sub(cc.v2(-238, 300)).mag() <= 29); }

    hit(point: cc.Vec2): DevelopmentAction | null {
        if (!this.contains(point)) return null;
        if (!this.isOpen) return { kind: "open" };
        if (point.sub(cc.v2(306, 557)).mag() <= 30) return { kind: "close" };
        if (point.y >= 453 && point.y <= 509) {
            const index = Math.floor((point.x + 328) / (656 / this.snapshot.heroes.length));
            if (this.snapshot.heroes[index]) { this.heroId = this.snapshot.heroes[index].id; this.slotId = null; this.itemId = null; this.page = 0; } return null;
        }
        for (let index = 0; index < this.slots.length; index++) {
            const x = (index % 3 - 1) * 212, y = 278 - Math.floor(index / 3) * 92;
            if (Math.abs(point.x - x) <= 96 && Math.abs(point.y - y) <= 38) { this.slotId = this.slots[index].id; this.itemId = null; this.page = 0; return null; }
        }
        for (let index = 0; index < this.rows.length; index++) if (Math.abs(point.y - (62 - index * 89)) <= 39 && Math.abs(point.x) <= 320) { this.itemId = this.rows[index].id; return null; }
        if (Math.abs(point.y + 337) <= 27) { if (point.x < -250) this.page = Math.max(0, this.page - 1); if (point.x > 250) this.page = Math.min(this.pages - 1, this.page + 1); this.itemId = null; return null; }
        if (point.y >= -578 && point.y <= -519) {
            const hero = this.snapshot.heroes.find((entry) => entry.id === this.heroId);
            if (point.x < -45 && hero?.canUpgrade && hero.cost.every((cost) => cost.owned >= cost.amount)) return { kind: "upgrade", actorId: hero.id };
            const slot = this.slots.find((entry) => entry.id === this.slotId), item = this.snapshot.items.find((entry) => entry.id === this.itemId);
            if (point.x > 45 && slot?.unlocked && item?.usable) return item.slotId === slot.id ? { kind: "unequip", slotId: slot.id } : { kind: "equip", itemId: item.id, slotId: slot.id };
        }
        return null;
    }

    update(snapshot: DemoSnapshot, icon: (atlas: string, name: string) => cc.SpriteFrame | null): void {
        this.snapshot = snapshot.development; this.node.active = Boolean(this.snapshot);
        if (!this.snapshot) return;
        const button = this.button; button.clear(); button.fillColor = cc.color(24, 46, 39); button.circle(-238, 300, 28); button.fill();
        button.strokeColor = cc.color(220, 234, 212); button.lineWidth = 3; button.circle(-238, 300, 28); button.stroke();
        button.circle(-238, 307, 7); button.moveTo(-251, 287); button.arc(-238, 287, 13, 0, Math.PI, false); button.stroke();
        if (!this.isOpen) return;
        this.usedLabels = 0; this.icons.forEach((sprite) => { sprite.node.active = false; });
        const g = this.frame; g.clear(); g.fillColor = cc.color(4, 10, 12, 235); g.rect(-360, -640, 720, 1280); g.fill();
        g.fillColor = cc.color(24, 38, 37); g.roundRect(-342, -602, 684, 1204, 6); g.fill(); g.strokeColor = cc.color(119, 143, 131); g.lineWidth = 2; g.stroke();
        this.text("\u9547\u90aa\u4eba", 0, 555, 500, 44, 28); this.text("\u00d7", 306, 557, 50, 50, 30);
        if (!this.snapshot.heroes.some((hero) => hero.id === this.heroId)) this.heroId = this.snapshot.heroes[0]?.id;
        const hero = this.snapshot.heroes.find((entry) => entry.id === this.heroId); if (!hero) return;
        this.snapshot.heroes.forEach((entry, index) => {
            const width = 656 / this.snapshot.heroes.length, x = -328 + width * (index + 0.5);
            this.text(entry.name, x, 481, width - 8, 45, 21, entry.id === hero.id ? cc.color(232, 212, 139) : cc.color(175, 187, 180));
            if (entry.id === hero.id) { g.fillColor = cc.color(209, 187, 104); g.rect(x - width * 0.4, 452, width * 0.8, 3); g.fill(); }
        });
        this.text(`Lv.${hero.level}   \u653b\u51fb ${hero.attributes.attack}   \u9632\u5fa1 ${hero.attributes.defense}   \u751f\u547d ${hero.attributes.maxHealth}`, 0, 407, 618, 48, 21);
        this.slots = this.snapshot.slots.filter((slot) => slot.actorId === hero.id);
        if (!this.slots.some((slot) => slot.id === this.slotId)) this.slotId = this.slots[0]?.id;
        this.slots.forEach((slot, index) => {
            const x = (index % 3 - 1) * 212, y = 278 - Math.floor(index / 3) * 92;
            g.fillColor = slot.id === this.slotId ? cc.color(59, 83, 69) : cc.color(34, 49, 45); g.roundRect(x - 96, y - 38, 192, 76, 4); g.fill();
            const equipped = this.snapshot.items.find((item) => item.id === slot.itemId);
            this.text(`${slot.name}\n${!slot.unlocked ? "\u672a\u89e3\u9501" : equipped?.name || "-"}`, x, y, 180, 68, 19, slot.unlocked ? cc.color(224, 232, 221) : cc.color(123, 137, 127));
        });
        const slot = this.slots.find((entry) => entry.id === this.slotId);
        const items = this.snapshot.items.filter((item) => item.type === slot?.type);
        this.pages = Math.max(1, Math.ceil(items.length / 4)); this.page = Math.min(this.page, this.pages - 1); this.rows = items.slice(this.page * 4, this.page * 4 + 4);
        if (!this.rows.some((item) => item.id === this.itemId)) this.itemId = this.rows[0]?.id;
        this.rows.forEach((item, index) => {
            const y = 62 - index * 89;
            if (item.id === this.itemId) { g.fillColor = cc.color(47, 67, 59); g.rect(-324, y - 40, 648, 80); g.fill(); }
            this.text(item.name, -62, y + 15, 370, 34, 21, item.quality >= 4 ? cc.color(233, 190, 100) : cc.color(216, 231, 219));
            this.text(`\u653b ${item.attributes.attack}   \u9632 ${item.attributes.defense}   \u751f\u547d ${item.attributes.maxHealth}`, -62, y - 17, 370, 28, 17);
            this.text(!item.usable ? "\u672a\u89e3\u9501" : item.slotId ? "\u5df2\u7a7f\u6234" : "\u7a7a\u95f2", 255, y, 120, 36, 18);
            if (item.icon) { const sprite = this.icons[index], frame = icon(item.icon.atlas, item.icon.frame); sprite.spriteFrame = frame; sprite.node.active = Boolean(frame); sprite.node.setContentSize(54, 54); sprite.node.setPosition(-278, y); }
        });
        if (!items.length) this.text("\u6682\u65e0\u88c5\u5907", 0, 14, 590, 50, 22);
        if (this.pages > 1) { this.text("<", -286, -337, 56, 45, 27); this.text(">", 286, -337, 56, 45, 27); this.text(`${this.page + 1}/${this.pages}`, 0, -337, 150, 38, 19); }
        const selected = this.snapshot.items.find((item) => item.id === this.itemId);
        const current = this.snapshot.items.find((item) => item.id === slot?.itemId);
        if (selected) {
            const removing = selected.slotId === slot?.id;
            const changes = [{ name: "\u653b\u51fb", value: removing ? -selected.attributes.attack : selected.attributes.attack - (current?.attributes.attack || 0) },
                { name: "\u9632\u5fa1", value: removing ? -selected.attributes.defense : selected.attributes.defense - (current?.attributes.defense || 0) },
                { name: "\u751f\u547d", value: removing ? -selected.attributes.maxHealth : selected.attributes.maxHealth - (current?.attributes.maxHealth || 0) }];
            changes.forEach((change, index) => this.text(`${change.name} ${this.delta(change.value)}`, (index - 1) * 210, -406, 205, 48, 20,
                change.value < 0 ? cc.color(239, 150, 128) : change.value > 0 ? cc.color(157, 224, 172) : cc.color(226, 235, 227)));
        }
        const affordable = hero.cost.every((cost) => cost.owned >= cost.amount);
        this.text(hero.canUpgrade ? hero.cost.map((cost) => `${cost.name} ${cost.amount} / ${cost.owned}`).join("   ") : "\u7b49\u7ea7\u5df2\u8fbe\u4e0a\u9650", 0, -476, 616, 48, 19, affordable ? cc.color(226, 235, 227) : cc.color(239, 150, 128));
        g.fillColor = hero.canUpgrade && affordable ? cc.color(63, 105, 79) : cc.color(47, 57, 54); g.roundRect(-304, -578, 260, 59, 4); g.fill(); this.text("\u5347\u7ea7", -174, -548, 240, 48, 23);
        g.fillColor = selected?.usable && slot?.unlocked ? cc.color(139, 99, 56) : cc.color(47, 57, 54); g.roundRect(44, -578, 260, 59, 4); g.fill(); this.text(selected?.slotId === slot?.id ? "\u5378\u4e0b" : "\u7a7f\u6234", 174, -548, 240, 48, 23);
        for (let index = this.usedLabels; index < this.labels.length; index++) this.labels[index].node.active = false;
    }

    private delta(value: number): string { return value > 0 ? `+${value}` : String(value); }
    private text(value: string, x: number, y: number, width: number, height: number, size: number, color = cc.color(226, 235, 227)): void {
        const index = this.usedLabels++, label = this.labels[index] || (this.labels[index] = this.label(this.panel, `DevelopmentText${index}`, size));
        label.node.active = true; label.node.setPosition(x, y); label.node.setContentSize(width, height); label.fontSize = size; label.lineHeight = size + 6; label.node.color = color; label.string = value;
    }
    private label(parent: cc.Node, name: string, size: number): cc.Label {
        const node = new cc.Node(name); parent.addChild(node); const label = node.addComponent(cc.Label); label.fontSize = size; label.lineHeight = size + 6;
        label.horizontalAlign = cc.Label.HorizontalAlign.CENTER; label.verticalAlign = cc.Label.VerticalAlign.CENTER; label.overflow = cc.Label.Overflow.SHRINK; node.color = cc.color(226, 235, 227); return label;
    }
}
