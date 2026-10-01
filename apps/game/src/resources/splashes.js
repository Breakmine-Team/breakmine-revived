export class SplashTexts {
    static SPLASHES = `Indev!
The Bountiful Update!
Alpha!
oooOOOOooo!
Appl1cation was here!
AlexMinecrafter was here!
Hollow was here!
Soup was here!
Martwixgame was here!
Duh Beast was here!
yrfooh was here!
Raptor4 was here!
TheCommandBox was here!
SpinningCubes was here!
Blaise was here!
Dinny was here!
Chlodog was here!
stryck was here!
Cool!
Modern!
Runs on a TV!
Woah!
Minetest Land!
:)
:O
:p
Bleh!
Zombies (coming soon)!
Coming soon to a browser near you!
Smartfridge compatible!
Dorfleetus!
Déjà vu!
Made by SpinningCubes!
RUNNNNNNNNNNNNNNNNNNNNNN!!!
4 + 4 = 44!
1 + 1 = 10!
Breakmine.com!
Bluestone: by Stryck!
PS4 Compatible! (maybe...)
I like beans!
Pre-included supertunnel!
Share your worlds!
Play with your friends!
Gamers unite!
Legendary!
Nahh Brotato that's crazy`.split('\n');

    static generateSplash() {
        return this.SPLASHES[Math.floor(Math.random() * this.SPLASHES.length)];
    }
}