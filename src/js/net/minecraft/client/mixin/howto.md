# MixinEngine Examples & Usage Guide

A lightweight, non-class, namespace-based modding and event system for JavaScript.

---

## 1. Quick Setup & Registration

`Mixin` is available globally as `globalThis.Mixin`. Game components register data dictionaries or target objects using namespaced keys (`namespace:name`).

```javascript
// Base Game Setup
const playerState = {
    name: "Aria",
    health: 100,
    speed: 5,
    takeDamage(amount) {
        this.health -= amount;
        console.log(`${this.name} took ${amount} damage! Current health: ${this.health}`);
        return this.health;
    }
};

// Register data dictionary in global Mixin registry
Mixin.register("game:player", playerState);
```
## 2. Standalone Global Functions (registerFunction)
You can register standalone global functions without wrapping them in objects or classes. They can be called directly via the returned handle or using Mixin.callFunction().

```javascript
// Base Game: Register a global function with no object target
const calculateDropRate = Mixin.registerFunction('game:calculateDropRate', (baseRate, luck) => {
    return baseRate * luck;
});

// Calling via the returned function handle OR Mixin.callFunction()
console.log(calculateDropRate(10, 1.5));                          // Output: 15
console.log(Mixin.callFunction('game:calculateDropRate', 10, 1.5)); // Output: 15
```
## Applying Mixins to Global Functions
Mods can target standalone functions directly using their namespace:functionName key.

```javascript
// Mod: Double drop rates during an active event
Mixin.apply('game:calculateDropRate', {
    around(originalFn, baseRate, luck) {
        const rate = originalFn(baseRate, luck);
        return rate * 2;
    },
    after(finalRate) {
        console.log(`[DropMod] Final drop rate: ${finalRate}`);
    }
});

calculateDropRate(10, 1.5);
// Console Output: [DropMod] Final drop rate: 30
```

---

## 3. Applying Mixins to Data Dictionaries

Mods can dynamically extend properties or hook into existing functions on registered targets.

```javascript
// Mod: Invincibility Shield & Damage Buff
Mixin.apply("game:player", {
    properties: {
        shield: 25,
        isShieldActive: true
    },
    methods: {
        takeDamage: {
            around(originalFn, amount) {
                // Intercept and modify calculation
                if (this.isShieldActive && this.shield > 0) {
                    const absorbed = Math.min(this.shield, amount);
                    this.shield -= absorbed;
                    amount -= absorbed;
                    console.log(`[ShieldMod] Absorbed ${absorbed} damage! Remaining shield: ${this.shield}`);
                }
                return originalFn(amount);
            },
            after(remainingHealth) {
                if (remainingHealth <= 0) {
                    console.log(`[Analytics] Player was defeated!`);
                }
            }
        }
    }
});
```

---

## 4. Namespaced Events & Cancellation

Events can be emitted across system boundaries. Normal listeners can mutate payload data or cancel processing.

```javascript
// Base Game: Player movement tick
function processPlayerMove(dx, dy, dz) {
    const payload = {
        playerId: "player_1",
        delta: { x: dx, y: dy, z: dz },
        cancelled: false
    };

    // Emit cancellable event
    const allowed = Mixin.emitCancellable("game:onPlayerMove", payload);

    if (!allowed) {
        console.log("Movement was blocked by a mod!");
        return;
    }

    console.log(`Player moved by (${payload.delta.x}, ${payload.delta.y}, ${payload.delta.z})`);
}

// Mod A: Priority Movement Restrictor
Mixin.on("game:onPlayerMove", (e) => {
    if (e.delta.y > 10) {
        console.log("[AntiCheatMod] Excessive jump detected!");
        e.cancelled = true;
        return false; // Prevents subsequent standard listeners
    }
}, 100);
```

---

## 5. Non-Cancellable (Guaranteed) Mixins

`onGuaranteed` guarantees execution even if an earlier mod cancelled the event.

```javascript
// Mod B: Core Audit Logging (Guaranteed Execution)
Mixin.onGuaranteed("game:onPlayerMove", (e, wasCancelled) => {
    console.log(`[AuditLog] Movement attempted for ${e.playerId}. Blocked: ${wasCancelled}`);
});
```

---

## 6. Read-Only Observers

`observe` provides immutable snapshots for logging, UI updates, or analytics without risking side-effects.

```javascript
// Observer: Log health updates safely
Mixin.observe("game:onHealthChange", (data) => {
    // data is read-only (frozen)
    console.log(`[UI] Health bar updated to: ${data.currentHealth}`);
});
```

---

## 7. Locking Critical Functions

Locking prevents further mixins or mod hooks from tampering with core engine routines.

```javascript
const player = Mixin.get("game:player");

// Lock critical function against patches
Mixin.lockFunction(player, "takeDamage");

// Subsequent attempt to patch will be blocked
Mixin.apply("game:player", {
    methods: {
        takeDamage: {
            before() {
                console.log("This will never run!");
            }
        }
    }
});
// Console Output: [Mixin] Cannot apply mixin to locked method 'takeDamage'.
```