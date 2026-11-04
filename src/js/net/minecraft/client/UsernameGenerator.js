export default function generateUsername() {
    const actions = [
        "Jumping", "Crawling", "Running", "Sleeping", "Waving",
        "Smiling", "Singing", "Coding", "Reading", "Inventive",
        "Energetic", "Swift", "Dancing", "Frozen", "Woven",
        "Crimson", "Shadowy", "Electric", "Ransacked", "Mystic"
    ];

    const objects = [
        "Potato", "Dolphin", "Rocket", "Anchor", "Planet",
        "Noodle", "Kraken", "Vortex", "Castle", "Quasar",
        "Pencil", "Lantern", "Walrus", "Comet", "Pixel",
        "Goblin", "Phantom", "Tsunami", "Phoenix", "Sprocket"
    ];

    let username = 'qwertyuiopasdfghjklzxcvbnm,./';

    while (username.length > 25) {
        const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
        const randomAction = actions[Math.floor(Math.random() * actions.length)];
        const randomObject = objects[Math.floor(Math.random() * objects.length)];
        const randomNumber = Math.floor(Math.random() * (99 - 10 + 1) + 10);
        username = `${capitalize(randomAction)}${capitalize(randomObject)}${randomNumber}`;
    }
    return username;
}