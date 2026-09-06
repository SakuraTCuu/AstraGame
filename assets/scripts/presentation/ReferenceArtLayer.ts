import { ActorSnapshot, DemoSnapshot } from "../core/demo/DemoSession";
import { ForegroundRenderer } from "./ForegroundRenderer";

interface ArtBinding { path: string; kind: "spine" | "atlas"; scale: number; height: number; fps: number; flip: boolean; skillAnimations?: Record<string, string>; skillPhases?: Record<string, { prepare?: string; hold?: string; release: string }>; }
interface ProjectileBinding { path: string; fps: number; scale: number; loop: boolean; offsetY: number; directional: boolean; offsetAlong?: number; anchorX?: number; }
interface ArtConfig { bundle: string; mapBundle: string; mapName: string; tileSize: number; mapWidth: number; mapHeight: number; depth: number; scale: number; tiles: string[]; bindings: Record<string, ArtBinding>; projectiles?: Record<string, ProjectileBinding>; areas?: Record<string, ProjectileBinding>; occlusionPolygons?: Array<Array<{ x: number; y: number }>>; }
interface ActorView { node: cc.Node; skeleton?: sp.Skeleton; sprite?: cc.Sprite; bars: cc.Graphics; binding: ArtBinding; action: string; age: number; lastX: number; facing: number; castId?: number; castCycle?: number; }

export class ReferenceArtLayer {
    private readonly ground: cc.Node;
    private readonly actors: cc.Node;
    private readonly config: ArtConfig;
    private readonly bundle: cc.AssetManager.Bundle;
    private readonly mapBundle: cc.AssetManager.Bundle;
    private readonly tiles = new Map<string, cc.Node>();
    private readonly views = new Map<string, ActorView>();
    private readonly projectileViews = new Map<number, cc.Sprite>();
    private readonly areaViews = new Map<number, cc.Sprite>();
    private readonly loaded = new Map<string, cc.Asset>();
    private readonly pending = new Set<string>();
    private readonly failed = new Set<string>();
    private readonly available: Set<string>;
    private readonly frames = new Map<string, cc.SpriteFrame[]>();
    private dead = false;
    private thumb: cc.Node = null;
    private readonly foreground: ForegroundRenderer;

    constructor(host: cc.Node, config: ArtConfig) {
        this.config = config;
        this.bundle = cc.assetManager.getBundle(config.bundle);
        this.mapBundle = cc.assetManager.getBundle(config.mapBundle);
        if (!this.bundle || !this.mapBundle) throw new Error("Reference bundles are not loaded");
        this.available = new Set(config.tiles);
        this.ground = new cc.Node("ReferenceGround");
        this.ground.zIndex = -1;
        this.actors = new cc.Node("ReferenceActors");
        this.actors.zIndex = 2;
        host.addChild(this.ground);
        host.addChild(this.actors);
        this.foreground = config.occlusionPolygons?.length ? new ForegroundRenderer(host, config.occlusionPolygons) : null;
        this.load(this.mapBundle, `${config.mapName}/thumb`, cc.Texture2D);
        for (const id of Object.keys(config.bindings)) {
            const binding = config.bindings[id];
            if (binding && id.indexOf("hero_") === 0) this.load(this.bundle, binding.path, binding.kind === "spine" ? sp.SkeletonData : cc.SpriteAtlas);
        }
    }

    hasActor(id: string): boolean { return this.views.has(id); }
    feedbackHeight(id: string): number | undefined {
        const key = this.config.bindings[id] ? id : id.split(":")[0].replace(/@\d+$/, "");
        return this.config.bindings[key]?.height;
    }
    hasProjectile(id: number): boolean { return this.projectileViews.has(id); }
    hasArea(id: number): boolean { return this.areaViews.has(id); }
    overviewTexture(): cc.Texture2D { return this.loaded.get(`${this.config.mapName}/thumb`) as cc.Texture2D; }

    update(snapshot: DemoSnapshot, camera: cc.Vec2, delta: number): void {
        const project = (x: number, y: number) => cc.v2((x - camera.x) * this.config.scale, (y - camera.y) * this.config.scale * this.config.depth - 80);
        const { tileSize, scale, depth, mapHeight, mapWidth, mapName } = this.config;
        const thumbnail = this.loaded.get(`${mapName}/thumb`) as cc.Texture2D;
        if (thumbnail && !this.thumb) {
            this.thumb = this.spriteNode("ReferenceOverviewGround", thumbnail);
            this.thumb.zIndex = -1;
            this.thumb.setContentSize(mapWidth * scale, mapHeight * scale);
            this.ground.addChild(this.thumb);
        }
        if (this.thumb) this.thumb.setPosition(project(mapWidth / 2, mapHeight / (depth * 2)));
        const minX = Math.floor((camera.x - 500) / tileSize);
        const maxX = Math.floor((camera.x + 500) / tileSize);
        const row = (mapHeight - camera.y * depth) / tileSize;
        const activeTiles = new Set<string>();
        for (let x = minX; x <= maxX; x++) for (let y = Math.floor(row - 1.2); y <= Math.ceil(row + 1.2); y++) {
            const key = `${mapName}/${x}_${y}`;
            if (!this.available.has(key)) continue;
            activeTiles.add(key);
            const texture = this.loaded.get(key) as cc.Texture2D;
            if (!texture) { this.load(this.mapBundle, key, cc.Texture2D); continue; }
            let node = this.tiles.get(key);
            if (!node) { node = this.spriteNode(key, texture); this.ground.addChild(node); this.tiles.set(key, node); }
            node.active = true;
            const logicalWidth = Math.min(tileSize, mapWidth - x * tileSize);
            const logicalHeight = Math.min(tileSize, mapHeight - y * tileSize);
            node.setContentSize(logicalWidth * scale, logicalHeight * scale);
            node.setPosition(project(x * tileSize + logicalWidth / 2, (mapHeight - y * tileSize - logicalHeight / 2) / depth));
        }
        this.tiles.forEach((node, key) => { if (!activeTiles.has(key)) { node.destroy(); this.tiles.delete(key); } });
        this.loaded.forEach((asset, key) => {
            if (key.startsWith(`${mapName}/`) && !key.endsWith("/thumb") && !activeTiles.has(key)) { asset.decRef(); this.loaded.delete(key); }
        });
        const present = new Set<string>();
        snapshot.actors.forEach((actor) => {
            const point = project(actor.x, actor.y);
            if (Math.abs(point.x) > 650 || Math.abs(point.y) > 1000) return;
            const bindingKey = this.config.bindings[actor.id] ? actor.id : actor.id.split(":")[0].replace(/@\d+$/, "");
            const binding = this.config.bindings[bindingKey];
            if (!binding) return;
            const asset = this.loaded.get(binding.path);
            if (!asset) { this.load(this.bundle, binding.path, binding.kind === "spine" ? sp.SkeletonData : cc.SpriteAtlas); return; }
            let view = this.views.get(actor.id);
            if (!view) { view = this.createActor(actor, binding, asset); this.views.set(actor.id, view); }
            present.add(actor.id);
            view.node.active = true;
            view.node.setPosition(point);
            view.node.zIndex = Math.round(100000 - actor.y);
            this.animate(view, actor, snapshot, delta);
        });
        const existing = new Set(snapshot.actors.map((actor) => actor.id));
        snapshot.exploration.pois.forEach((poi) => {
            const binding = this.config.bindings[poi.id];
            if (!binding || !["portal", "fog_gate", "chest"].includes(poi.type) || (poi.type === "fog_gate" && poi.completed)) return;
            existing.add(poi.id);
            const point = project(poi.x, poi.y);
            if (Math.abs(point.x) > 650 || Math.abs(point.y) > 1000) return;
            const asset = this.loaded.get(binding.path);
            if (!asset) { this.load(this.bundle, binding.path, binding.kind === "spine" ? sp.SkeletonData : cc.SpriteAtlas); return; }
            let view = this.views.get(poi.id);
            if (!view) { view = this.createActor(poi, binding, asset); this.views.set(poi.id, view); }
            present.add(poi.id);
            view.node.active = true; view.node.setPosition(point); view.node.zIndex = Math.round(100000 - poi.y); view.bars.clear();
            if (view.skeleton) {
                const names = view.skeleton.skeletonData.getRuntimeData().animations.map((entry) => entry.name);
                const action = names.includes("idle") ? "idle" : names[0];
                if (action && view.action !== action) view.skeleton.setAnimation(0, action, true);
                view.action = action; view.skeleton.paused = snapshot.runState !== "running" && snapshot.runState !== "recovering";
            } else {
                const action = poi.completed ? "dead" : "idle";
                const key = `${binding.path}:${action}`;
                let frames = this.frames.get(key);
                if (!frames) {
                    const all = (asset as cc.SpriteAtlas).getSpriteFrames();
                    frames = all.filter((frame) => new RegExp(`^${action}[_-]`).test(frame.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
                    if (!frames.length) frames = all.slice(0, 1);
                    this.frames.set(key, frames);
                }
                if (view.action !== action) { view.age = !view.action && poi.completed ? frames.length / binding.fps : 0; view.action = action; }
                if (snapshot.runState === "running" || snapshot.runState === "recovering") view.age += delta;
                if (frames.length) view.sprite.spriteFrame = frames[poi.completed ? Math.min(frames.length - 1, Math.floor(view.age * binding.fps)) : Math.floor(view.age * binding.fps) % frames.length];
            }
        });
        this.views.forEach((view, id) => {
            if (!existing.has(id) || !present.has(id)) { view.node.destroy(); this.views.delete(id); }
            else view.node.active = present.has(id);
        });
        const presentProjectiles = new Set<number>();
        for (const projectile of snapshot.projectiles) {
            const binding = this.config.projectiles?.[projectile.skillId];
            if (!binding) continue;
            const point = project(projectile.x, projectile.y);
            if (Math.abs(point.x) > 800 || Math.abs(point.y) > 1200) continue;
            const atlas = this.loaded.get(binding.path) as cc.SpriteAtlas;
            if (!atlas) { this.load(this.bundle, binding.path, cc.SpriteAtlas); continue; }
            const key = `${binding.path}:projectile`;
            let frames = this.frames.get(key);
            if (!frames) { frames = atlas.getSpriteFrames().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })); this.frames.set(key, frames); }
            if (!frames.length) continue;
            let sprite = this.projectileViews.get(projectile.id);
            if (!sprite) {
                const node = new cc.Node(`Projectile_${projectile.id}`); sprite = node.addComponent(cc.Sprite); this.actors.addChild(node); this.projectileViews.set(projectile.id, sprite);
            }
            presentProjectiles.add(projectile.id);
            const frame = Math.floor(projectile.age * binding.fps);
            sprite.spriteFrame = frames[binding.loop ? frame % frames.length : Math.min(frames.length - 1, frame)];
            sprite.node.setPosition(point.x, point.y + binding.offsetY * scale);
            sprite.node.setScale(binding.scale * scale * (projectile.directionX < 0 ? -1 : 1), binding.scale * scale);
            sprite.node.angle = binding.directional ? Math.atan2(projectile.directionY * depth, Math.abs(projectile.directionX)) * 180 / Math.PI * (projectile.directionX < 0 ? -1 : 1) : 0;
            sprite.node.zIndex = Math.round(100000 - projectile.y) + 1;
        }
        this.projectileViews.forEach((sprite, id) => { if (!presentProjectiles.has(id)) { sprite.node.destroy(); this.projectileViews.delete(id); } });
        const presentAreas = new Set<number>();
        for (const area of snapshot.areas || []) {
            const binding = area.effectKey && this.config.areas?.[area.effectKey];
            if (!binding) continue;
            const point = project(area.x, area.y);
            if (Math.abs(point.x) > 1000 || Math.abs(point.y) > 1400) continue;
            const atlas = this.loaded.get(binding.path) as cc.SpriteAtlas;
            if (!atlas) { this.load(this.bundle, binding.path, cc.SpriteAtlas); continue; }
            const key = `${binding.path}:area`;
            let frames = this.frames.get(key);
            if (!frames) { frames = atlas.getSpriteFrames().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })); this.frames.set(key, frames); }
            if (!frames.length) continue;
            let sprite = this.areaViews.get(area.id);
            if (!sprite) { const node = new cc.Node(`Area_${area.id}`); sprite = node.addComponent(cc.Sprite); this.actors.addChild(node); this.areaViews.set(area.id, sprite); }
            presentAreas.add(area.id);
            const frame = Math.floor(area.age * binding.fps);
            sprite.spriteFrame = frames[binding.loop ? frame % frames.length : Math.min(frames.length - 1, frame)];
            const facing = area.moving && area.directionX < 0 ? -1 : 1;
            sprite.node.anchorX = binding.anchorX ?? 0.5;
            sprite.node.setPosition(point.x + area.directionX * (binding.offsetAlong || 0) * scale,
                point.y + (binding.offsetY + area.directionY * (binding.offsetAlong || 0) * depth) * scale);
            sprite.node.setScale(binding.scale * scale * facing, binding.scale * scale);
            sprite.node.angle = binding.directional ? (area.moving ? Math.atan2(area.directionY * depth, Math.abs(area.directionX)) * facing : Math.atan2(area.directionY * depth, area.directionX)) * 180 / Math.PI : 0;
            sprite.node.zIndex = (area.moving ? 0 : -1000000) + Math.round(100000 - area.y);
        }
        this.areaViews.forEach((sprite, id) => { if (!presentAreas.has(id)) { sprite.node.destroy(); this.areaViews.delete(id); } });
        if (this.foreground) this.foreground.update(this.ground, snapshot, camera, scale, depth);
    }

    iconFrame(path: string, name: string): cc.SpriteFrame | null {
        if (!this.bundle) return null;
        const asset = this.loaded.get(path);
        if (!asset) { this.load(this.bundle, path, name ? cc.SpriteAtlas : cc.SpriteFrame); return null; }
        return name ? (asset as cc.SpriteAtlas).getSpriteFrame(name) : asset as cc.SpriteFrame;
    }

    destroy(): void {
        this.dead = true;
        if (this.foreground) this.foreground.destroy();
        this.ground.destroy();
        this.actors.destroy();
        this.loaded.forEach((asset) => asset.decRef());
        this.loaded.clear();
        this.views.clear();
        this.projectileViews.clear();
        this.areaViews.clear();
    }

    private load(bundle: cc.AssetManager.Bundle, path: string, type: typeof cc.Asset): void {
        if (this.loaded.has(path) || this.pending.has(path) || this.failed.has(path)) return;
        this.pending.add(path);
        bundle.load(path, type, (error: Error, asset: cc.Asset) => {
            this.pending.delete(path);
            if (this.dead) { if (asset) asset.addRef().decRef(); return; }
            if (error) { this.failed.add(path); cc.warn("Reference art unavailable:", path, error.message); return; }
            asset.addRef();
            this.loaded.set(path, asset);
        });
    }

    private spriteNode(name: string, texture: cc.Texture2D): cc.Node {
        const node = new cc.Node(name);
        const sprite = node.addComponent(cc.Sprite);
        sprite.spriteFrame = new cc.SpriteFrame(texture);
        sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
        return node;
    }

    private createActor(actor: Pick<ActorSnapshot, "id" | "x">, binding: ArtBinding, asset: cc.Asset): ActorView {
        const node = new cc.Node(`Art_${actor.id}`);
        const art = new cc.Node("Visual");
        node.addChild(art);
        this.actors.addChild(node);
        const barsNode = new cc.Node("Health");
        barsNode.zIndex = 1;
        node.addChild(barsNode);
        const view: ActorView = { node, binding, bars: barsNode.addComponent(cc.Graphics), action: "", age: 0, lastX: actor.x, facing: 1 };
        if (binding.kind === "spine") {
            view.skeleton = art.addComponent(sp.Skeleton);
            view.skeleton.skeletonData = asset as sp.SkeletonData;
            view.skeleton.premultipliedAlpha = false;
            art.setScale(binding.scale * this.config.scale);
        } else {
            view.sprite = art.addComponent(cc.Sprite);
            art.anchorY = 0;
            art.setScale(binding.scale * this.config.scale);
        }
        return view;
    }

    private animate(view: ActorView, actor: ActorSnapshot, snapshot: DemoSnapshot, delta: number): void {
        const moving = Math.abs(actor.x - view.lastX) > 0.1 || ["moving", "chasing", "returning"].includes(actor.state);
        const cast = snapshot.casts.find((cast) => cast.sourceId === actor.id);
        const frozen = actor.controls?.some((control) => control.kind === "freeze");
        const fleeing = actor.controls?.some((control) => control.kind === "fear") && !actor.controls.some((control) => ["freeze", "stun", "airborne", "root"].includes(control.kind));
        const restrained = actor.controls?.some((control) => control.kind !== "silence");
        let action = actor.hp <= 0 ? "dead" : fleeing ? "move" : actor.state === "displaced" || actor.state === "controlled" ? "hurt" : cast ? "attack" : moving && !restrained ? "move" : "idle";
        if (cast) action = view.binding.skillAnimations && view.binding.skillAnimations[cast.skillId] || "attack";
        const target = snapshot.actors.find((target) => target.id === actor.targetId);
        const dx = cast && !fleeing ? cast.point.x - actor.x : moving || fleeing ? actor.x - view.lastX : target ? target.x - actor.x : 0;
        if (Math.abs(dx) > 0.2) view.facing = Math.sign(dx);
        view.lastX = actor.x;
        const visual = view.skeleton ? view.skeleton.node : view.sprite.node;
        visual.y = Math.max(cast?.elevation || 0, actor.elevation || 0) * this.config.scale;
        view.bars.node.y = visual.y;
        visual.scaleX = Math.abs(visual.scaleX) * view.facing * (view.binding.flip ? -1 : 1);
        if (view.skeleton) {
            const available = view.skeleton.skeletonData.getRuntimeData().animations;
            const phases = cast && view.binding.skillPhases?.[cast.skillId];
            if (phases && cast.phase === "windup" && phases.prepare) {
                const preparing = available.find((entry) => entry.name === phases.prepare);
                action = preparing && cast.duration - cast.remaining < preparing.duration / (cast.playbackRate || 1) ? phases.prepare : phases.hold || phases.prepare;
            }
            if (!available.some((entry) => entry.name === action)) action = action === "dead" ? "die" : action === "hurt" ? "idle" : "attack";
            if (!available.some((entry) => entry.name === action)) action = "idle";
            const track = view.skeleton.getCurrent(0);
            if (!restrained && actor.state !== "displaced" && action === "idle" && view.action !== "idle" && view.action !== "move" && track && !track.isComplete()) action = view.action;
            if (view.action !== action || (cast && (view.castId !== cast.id || view.castCycle !== cast.cycle))) view.skeleton.setAnimation(0, action, action === "idle" || action === "move" || phases?.hold === action);
            view.skeleton.timeScale = cast?.playbackRate || 1;
            view.skeleton.paused = Boolean(frozen) || (snapshot.runState !== "running" && snapshot.runState !== "recovering");
        } else {
            const key = `${view.binding.path}:${action}`;
            let frames = this.frames.get(key);
            if (!frames) {
                const atlas = this.loaded.get(view.binding.path) as cc.SpriteAtlas;
                frames = atlas.getSpriteFrames().filter((frame) => new RegExp(`(?:^|[_-])${action}(?:[_-]|\\d|$)`, "i").test(frame.name)).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
                if (!frames.length) frames = atlas.getSpriteFrames().slice(0, 1);
                this.frames.set(key, frames);
            }
            if (view.action !== action || (cast && (view.castId !== cast.id || view.castCycle !== cast.cycle))) view.age = 0;
            if (!frozen && (snapshot.runState === "running" || snapshot.runState === "recovering")) view.age += delta * (cast?.playbackRate || 1);
            if (frames.length) view.sprite.spriteFrame = frames[actor.hp <= 0 ? Math.min(frames.length - 1, Math.floor(view.age * view.binding.fps)) : Math.floor(view.age * view.binding.fps) % frames.length];
        }
        view.action = action;
        view.castId = cast && cast.id;
        view.castCycle = cast && cast.cycle;
        const g = view.bars;
        g.clear();
        if (actor.hp <= 0 || actor.kind === "resource") return;
        const height = view.binding.height * this.config.scale;
        const width = actor.kind === "boss" ? 110 : 48;
        g.fillColor = cc.color(15, 18, 18, 220); g.rect(-width / 2, height, width, 7); g.fill();
        g.fillColor = actor.team === "player" ? cc.color(72, 208, 118) : cc.color(226, 73, 70);
        g.rect(-width / 2 + 1, height + 1, (width - 2) * actor.hp / actor.maxHp, 5); g.fill();
        if (actor.shield > 0) {
            g.fillColor = cc.color(16, 40, 50, 230); g.rect(-width / 2, height + 9, width, 5); g.fill();
            g.fillColor = cc.color(118, 226, 246); g.rect(-width / 2 + 1, height + 10, (width - 2) * Math.min(1, actor.shield / actor.maxHp), 3); g.fill();
        }
        if (actor.maxEnergy) {
            g.fillColor = cc.color(18, 27, 43, 230); g.rect(-width / 2, height - 5, width, 4); g.fill();
            g.fillColor = cc.color(110, 190, 230); g.rect(-width / 2, height - 5, width * (actor.energy || 0) / actor.maxEnergy, 3); g.fill();
        }
    }
}
