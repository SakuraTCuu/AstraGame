const { ccclass } = cc._decorator;

@ccclass("AstraHostLoader")
export class AstraHostLoader extends cc.Component {
    async start(): Promise<void> {
        try {
            for (const name of ["resources", "spine", "comm", "launch", "basemodules", "modules"]) {
                if (!cc.assetManager.getBundle(name)) await new Promise<void>((resolve, reject) =>
                    cc.assetManager.loadBundle(name, (error) => error ? reject(error) : resolve()));
            }
            const prefab = await new Promise<cc.Prefab>((resolve, reject) => cc.assetManager.getBundle("launch").load("Main", cc.Prefab,
                (error, asset: cc.Prefab) => error ? reject(error) : resolve(asset)));
            const root = cc.instantiate(prefab);
            root.name = "HostMain"; this.node.addChild(root);
            root.addComponent("LayerManager");
            root.addComponent("AstraHostProbe");
        } catch (error) { cc.error("Host probe failed", error); }
    }
}
