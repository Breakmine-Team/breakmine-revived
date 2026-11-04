# Native gameplay reference and BreakMine adapter

`npm run gameplay:import -- /path/to/reference-client.jar /path/to/launcher/libraries`
validates the worldgen source lock, executes `GameplayOracle.java` against that
JAR, and imports 1,658 item initializer records: main-hand attributes, food,
stack limits, durability, consumption duration, weapon wear, attack animation,
equipment slots, armor, armor toughness and knockback resistance,
and ordered tool rules. It also imports HUD PNGs and four height-adjusted plains
temperatures. PNG hashes and Java floats remain
in `generated/gameplay.json`; the importer is reproducible and rejects another
JAR. It does not distribute Java source or infer stats from material indices.

`combat.mjs` and `food.mjs` adapt the vanilla attack-strength/damage, critical-hit
conditions, hurt-resistance, knockback and FoodData behavior to existing game
entities. Relevant reference methods are `Player.attack`, `LivingEntity.hurtServer`,
`LivingEntity.knockback`, `FoodData.tick` and `Biome.getHeightAdjustedTemperature`.
The server calculates player attacks from its selected inventory item, checks
reach and intervening solid blocks, and publishes absolute health. The client
does not predict another player's damage. Existing first-person/mining animation
systems are not replaced. Damage text and extra food tooltip lines are BreakMine
UI additions, not vanilla sprites.

Combat and multiplayer authority are still incomplete. Basic player armor and
some status effects work; armor enchantments, shields, absorption and full
server-authoritative movement need more work. Existing clients still report
environmental damage and movement. Knockback and sweeping use the existing
entity and collision systems.
Vanillith's `vanillithPlayable` mode uses the existing survival interaction path;
terrain-only spectator/debug mode remains read-only. The combat-preview guard
must not suppress right-click placement or block interactions in playable mode.

## Playability pass

- Fixed right-click placement and the undefined sword-durability stack variable.
- Charged falling hits include the climbable/blindness/passenger checks, critical
  sprite feedback, and the existing 1.5x damage multiplier. Sprint knockback uses
  facing and slows the attacker; stronger hits inside the hurt cooldown do not
  repeat the base hurt lift.
- Living velocity conversion is shared with server hit messages. AI ignores
  creative/spectator players in playable mode; peaceful removes supported monsters.
- Survival mining includes airborne, submerged, haste and fatigue speed modifiers;
  creative retains immediate breaking. Tool harvest tiers remain enforced.
- `scripts/import-item-visuals.mjs <pinned.jar>` imports 521 sprite item entries,
  534 textures and JAR display transforms. Inventory and held contexts are
  resolved independently; all seven spear variants retain their distinct icon
  and 32px in-hand sheet. Source images from the active atlas/pack are retained
  for full-resolution held extrusion. Thrown tridents use the shared textured
  JAR cuboids and projectile transform instead of placeholder geometry.
  This is visual coverage, not every item's use behavior. The catalog lists
  four unresolved inventory models; clock/compass dynamics, shield special
  rendering, spyglass held geometry and charging behavior remain incomplete.
- Imported components configure registered items' stack limits, durability,
  attack damage/speed, animation and wear. Native terrain mining evaluates
  ordered JAR tool rules against the imported block tags, including copper and
  netherite. Ordinary foods use the shared edible pipeline and native duration.
  New foods requiring consume effects are not silently treated as ordinary
  foods; their effects, consumption remainders and animations beyond the
  existing eating path still need work.
- Pale Garden is still excluded by the climate sampler, but its available
  block and item families are no longer deliberately excluded from inventory,
  crafting, placement or drops. Biome generation remains different from the JAR.
- Vertical biome lookup clamps to the native container bounds and chunk
  publication/unloading invalidates the full neighboring biome-blend halo.

Still incomplete: all-entity model/AI coverage, full natural spawning, all item
use/components, all block interactions and a verified survival playthrough.
Existing undead goals and pathfinding are not a port of every Minecraft mob.
Unit/build results do not establish full JAR gameplay or visual parity.

`scripts/import-crafting-remainders.mjs` extracts the JAR's item crafting
remainders; both crafting grids return those containers. Repairing two matching
damageable items uses the JAR's durability formula and keeps binding and
vanishing curses. Slabs, straight stairs, basic two-block doors, trapdoors,
fence gates, and axis-oriented blocks use imported placement states; trapdoors
and gates can also be opened by hand where supported. Common stair materials
include imported corner states and update their shape when adjacent blocks
change; selected doors include both hinge variants. Other materials still fall
back to straight stairs or left hinges because native rendering uses limited
12-bit block IDs. Supported imported doors, trapdoors and fence gates react to
adjacent Breakmine Bluestone sources and wires; the native powered property is
retained separately even when its render model is shared. Bluestone still uses
Breakmine's existing signal propagation rather than the full JAR redstone
simulation. The stonecutter exposes imported reference stonecutting recipes through
its own selection screen for inputs and outputs represented in the client.
Other workstation-specific recipes remain incomplete. If the player inventory
is full when its screen closes, its input remains in the stonecutter's local
inventory until it can be retrieved.

Survival inventory supports equipping the four player armor slots, saving them,
updating the HUD and applying the JAR armor/toughness damage formula with basic
equipment wear. Enchantment protection, every damage source and armor model
rendering remain incomplete.

Run `npm run gameplay:test` for JAR-asset, combat/food and actual client JSON/HUD
path regressions. Native model winding, exterior lighting, bamboo variants and
snow bounds are tested by `packages/vanilla-worldgen/test/render-regressions.test.mjs`.
Build and unit tests do not substitute for two-player visual/playthrough QA.
