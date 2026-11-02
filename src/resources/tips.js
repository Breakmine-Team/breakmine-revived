export class LoadingTips {
    static TIPS = `Breakmine started as a joke.
Multiplayer PvP was very buggy for a while.
Still in development!
Breakmine was made in 2025.
Created by SpinningCubes Games!
Patchwork was originally called ModForge.
The first mod was BombCraft.
Bluestone used to be a mod by stryck.
Breakmine used to only have one block: dirt.
Try the Nino server!
Breakmine is NOT Minecraft.
Breakmine was made after a joke in an art classroom.`.split('\n');

    static generateTip() {
        if (this.TIPS.length === 0) {
            return null;
        }
        return this.TIPS[Math.floor(Math.random() * this.TIPS.length)];
    }
}
