

# Battlefield 6 Portal Utilities - Library Context
This document contains implementation details explicitly tagged for AI consumption.
Always prefer patterns found here over raw 'mod' namespace calls.

---

## Module: animations

The `Animations` namespace provides a high-performance UI animation engine tailored for server-side QuickJS environments in Battlefield Portal. The system is designed with zero-allocation steady-state loops, Structure of Arrays (SoA) pooling, and permanent master ticker integration with instant early exit.

> **Note:** Since this module imports and relies on `Events`, **you must use the `Events` module as your only mechanism to subscribe to game events**—do not implement or export any Battlefield Portal event handler functions in your own code. See the [Events module](../events/README.md#known-limitations--caveats).

### Examples

#### 1. Standard Tween Animation

```ts
import { Animations } from 'bf6-portal-utils/animations';
import { Transitions } from 'bf6-portal-utils/transitions';

// Start a tween animation (returns unboxed AnimationID or null if pool full)
const animId = Animations.startTween({
    from: 0,
    to: 200,
    duration: 600, // ms
    delayMs: 150, // optional start delay
    easing: Transitions.Easing.outExpo,
    onUpdate: (value) => {
        widget.width = value;
    },
    onComplete: () => {
        // Animation completed
    },
});

if (animId !== null) {
    // Functional lifecycle control
    Animations.pause(animId);
    Animations.resume(animId);
    Animations.stop(animId);

    // Status queries
    const active = Animations.isActive(animId); // true if allocated in pool
    const running = Animations.isRunning(animId); // true if ticking, undefined if invalid
    const paused = Animations.isPaused(animId); // true if paused, undefined if invalid
}
```

#### 2. Spring Physics Animation

```ts
import { Animations } from 'bf6-portal-utils/animations';

const springId = Animations.startSpring({
    from: 0,
    to: 100,
    stiffness: 180,
    damping: 24,
    precision: 0.001,
    onUpdate: (value) => {
        widget.x = value;
    },
    onComplete: () => {
        // Spring settled at target
    },
});
```

#### 3. Decay / Inertia Momentum Animation

```ts
import { Animations } from 'bf6-portal-utils/animations';

const decayId = Animations.startDecay({
    from: 0,
    velocity: 500, // units per second
    deceleration: 0.997, // friction per ms
    precision: 0.01,
    onUpdate: (value) => {
        widget.scrollOffset = value;
    },
    onComplete: () => {
        // Decay settled
    },
});
```

---

## Module: benchmarker

The `Benchmarker` namespace provides tiny, focused helpers for **measuring how long pure JavaScript work takes to run** inside Battlefield Portal’s QuickJS runtime. It lets you answer questions like “How many times can I safely run this loop in 10ms?” or “Roughly how expensive is this function per call?” without having to wire up your own timing loops.

**Important:** The module is designed for **local benchmarking and experimentation**, not for production in-game code paths. You should use it in isolated test mods, in small debug harnesses, or during development when tuning algorithms—then bake the insights into your final design.

Because timing inside a live server can be noisy (tick scheduling, other scripts, engine load), treat these tools as **directional**: use them to compare alternatives and to find safe budgets, not to guarantee exact numbers.

### Example: Comparing Two Implementations

```ts
import { Benchmarker } from 'bf6-portal-utils/benchmarker';

function implementationA(): void {
    // Some pure-JS logic
}

function implementationB(): void {
    // Alternative pure-JS logic
}

export async function OnGameModeStarted(): Promise<void> {
    const iterations = 10_000;

    const totalMsA = Benchmarker.run(implementationA, iterations);
    const totalMsB = Benchmarker.run(implementationB, iterations);

    const perOpA = totalMsA / iterations;
    const perOpB = totalMsB / iterations;

    mod.Trace(`A: ${perOpA.toFixed(4)} ms/op, B: ${perOpB.toFixed(4)} ms/op`);
}
```

### Example: Finding a Safe Per-Tick Budget

```ts
import { Benchmarker } from 'bf6-portal-utils/benchmarker';

function expensiveWork(): void {
    // Pure-JS work you might want to do per player, per tick
}

export async function OnGameModeStarted(): Promise<void> {
    // Roughly, how many times can we run this in ~5ms?
    const safeIterations = Benchmarker.findMaxIterations(expensiveWork, 5, 100);

    mod.Trace(`Safe iterations in 5ms window: ${safeIterations}`);
}
```

### Example: Async Benchmarking (Pure Promises Only)

```ts
import { Benchmarker } from 'bf6-portal-utils/benchmarker';

async function purePromiseWork(): Promise<void> {
    // NOTE: This must NOT call `mod.Wait()` or `Timers.setTimeout()`
    await Promise.resolve();
}

export async function OnGameModeStarted(): Promise<void> {
    const iterations = 1_000;
    const totalMs = await Benchmarker.runAsync(purePromiseWork, iterations);
    const perOp = totalMs / iterations;

    mod.Trace(`Async work: ${perOp.toFixed(4)} ms/op (pure Promise version)`);
}
```

## Known Limitations & Caveats

- **Do not benchmark `mod.Wait` or `Timers.setTimeout`** – Any function that yields to the engine (directly or indirectly) will stall until the next server tick (~33ms), turning a microbenchmark into a “count how many frames passed” test. This is why the async helpers explicitly warn against using `mod.Wait` or `Timers.setTimeout` in the callback.
- **Server variability** – Results can vary between runs and between servers depending on load, other scripts, and engine scheduling. Use the numbers as **guides**, not strict guarantees.
- **Blocking work only** – Benchmarks only measure the time spent in the function body plus any pure-JS work it calls. They do not capture time waiting on engine I/O or network.
- **No built-in logging** – This module intentionally does not depend on the Logging or Logger modules. You are responsible for logging or displaying results.

---

## Module: callback-handler

The `CallbackHandler` namespace provides a lightweight utility for safely invoking user callbacks (sync or async) with **zero runtime allocations**. It catches synchronous throws and asynchronous promise rejections, logs them via a passed-in `Logging` instance at `LogLevel.Error`, and does not rethrow—ensuring that a failing callback cannot disrupt host execution.

### Example

```ts
import { CallbackHandler } from 'bf6-portal-utils/callback-handler';
import { Logging } from 'bf6-portal-utils/logging';

const logging = new Logging('MyModule');

// Optional callback with up to 4 arguments (zero allocations)
function notifyPlayer(player: mod.Player, message: string): void {
    CallbackHandler.invoke(this._onMessage, player, message, undefined, undefined, logging, 'notifyPlayer');
}

// Optional no-args callback (zero allocations)
function tick(): void {
    CallbackHandler.invokeNoArgs(this._onTick, logging);
}
```

---

## Module: clocks

The `Clocks` namespace provides high-performance **CountUp** (stopwatch) and **CountDown** (timer) functionality for Battlefield Portal experiences. The clocks are efficient, drift-resistant, and well-suited to UIs that need to update every second, every minute, or when the clock completes—e.g. match timers, round timers, or bomb fuse countdowns. Time is tracked internally as accumulated milliseconds while the clock is running; the next tick is scheduled to align with whole-second boundaries, minimizing drift. Callbacks (`onSecond`, `onMinute`, `onComplete`) are invoked only when the corresponding integer value changes, and errors in callbacks are caught and logged so they cannot break the clock.

> **Note:** Since this module imports and relies on `Events`, **you must use the `Events` module as your only mechanism to subscribe to game events**—do not implement or export any Battlefield Portal event handler functions in your own code. See the [Events module](../events/README.md#known-limitations--caveats).

### Example

```ts
import { Clocks } from 'bf6-portal-utils/clocks';
import { Events } from 'bf6-portal-utils/events';

Clocks.setLogging((text) => console.log(text), Clocks.LogLevel.Info);

let roundClockId: Clocks.ClockID = Clocks.INVALID_CLOCK_ID;

Events.OnGameModeStarted.subscribe(() => {
    // 5-minute round timer; update UI every second, voice over every minute, and end round when time runs out
    roundClockId = Clocks.createCountDown(5 * 60, {
        onSecond: (seconds) => updateTimerDisplay(seconds),
        onMinute: (minutes) => announceMinute(minutes),
        onComplete: () => endRound(),
    });

    Clocks.start(roundClockId);
});

Events.OnPlayerDeployed.subscribe((player: mod.Player) => {
    // Stopwatch for a single player (e.g. lap time), with 1-hour limit
    const stopwatchId = Clocks.createCountUp({
        timeLimitSeconds: 3600,
        onSecond: (seconds) => setHudSeconds(seconds),
        onComplete: () => showTimeLimitReached(),
    });

    Clocks.start(stopwatchId);

    Events.OnPlayerDied.subscribe(
        (victim: mod.Player, killer: mod.Player, deathType: mod.DeathType, weapon: mod.WeaponUnlock) => {
            Clocks.stop(stopwatchId);
        }
    );
});
```

## When Callbacks Fire (Lifecycle)

Callbacks are driven by an internal **tick** that runs when the clock starts or resumes, once after `stop()` or `pause()` (to commit elapsed time), on a timer at whole-second boundaries while running, when `addSeconds()` or `subtractSeconds()` is called, and when `reset()` is called while the clock is **running** (to report the snapped-to-start position). Each tick checks whether an integer second or minute boundary has been reached or crossed since the last reported value, and whether the clock has reached its completion condition.

### `onSecond(currentSeconds: number)`

Fires every time the clock reaches or crosses an integer second boundary (see [Rounding](#rounding-count-up-vs-count-down)) for which it has not yet invoked `onSecond`. That can happen when:

- Time elapses normally while the clock is running (one firing per whole second).
- `start()` or `resume()` runs on a fresh clock (first tick reports the current integer second).
- `stop()` or `pause()` commits elapsed time and the resulting value crosses a second boundary not yet reported.
- `addSeconds()` or `subtractSeconds()` adjusts time so that the integer second changes.
- `reset()` while the clock is **running** clears elapsed time but keeps it running; the deferred tick reports the starting integer second (and minute if applicable), same idea as the first tick after `start()`.
- `reset()` while the clock is **stopped** or **paused** does not run a tick or fire `onSecond` / `onMinute`; call `start()` to begin again from the initial value.

### `onMinute(currentMinutes: number)`

Follows the same rules as `onSecond`, but for integer **minute** boundaries (derived from the rounded second value: `floor(seconds/60)` for count-up, `ceil(seconds/60)` for count-down).

### `onComplete()`

Fires at most once per clock when the completion condition is met during a tick:

- **CountDown:** when remaining time reaches 0.
- **CountUp:** when elapsed time reaches the optional `timeLimitSeconds` (default 86400 if not set).

That can happen when time elapses normally while running, or when `stop()` or `pause()` commits elapsed time and the clock is then in a completed state. `reset()` never fires `onComplete` as the clock's internal state is immediately reset before a tick can run to check for completion. In the tick where a CountDown clock reaches 0, `onComplete()` is invoked first, then `onSecond(0)` (and possibly `onMinute(0)`) in the same tick.

### Synchronous vs asynchronous callbacks

Synchronous callbacks run inside the tick and **block** the clock logic: the next tick is only scheduled via `setTimeout` after `onComplete`, `onSecond`, and `onMinute` have been invoked. The time until the next whole-second boundary is computed at that moment (when `setTimeout` is called), so the delay is based on the current time after your callbacks return. As a result, short synchronous callbacks should not cause drift—as long as they are not long-running (i.e. no longer than a second in total per tick). Asynchronous callbacks are preferred when you need to do more work, but short synchronous callbacks (e.g. updating a simple UI or game value, or playing a voice over) are safe.

---

## Module: colors

The `Colors` namespace provides a high-performance, transparent color representation and manipulation engine tailored for Battlefield Portal. Colors are represented as simple transparent JavaScript objects `{ r, g, b }` with normalized channel values in the range $[0, 1]$.

Key features include:

- **Transparent Representation (`Color`)** – Plain `{ r, g, b }` objects with zero opaque wrapper overhead, allowing instant property access, destructuring, spread operations, and JSON serialization.
- **Dedicated Color Domain Utilities** – Built-in support for hex parsing (`fromHex`), hex formatting (`toHex`), clamping (`clamp`), tinting / Hadamard modulation (`tint`), and perceived luminance calculations (`luminance`).
- **Comprehensive Math & Blending** – Zero-allocation `lerp`, `add`, `subtract`, `multiply`, `divide`, `equals`, `set`, `copy`, and `clone` utilities supporting optional caller-provided `out` objects for garbage-free per-frame loops.
- **Standard & Battlefield Brand Presets** – Pre-packaged constants (`WHITE`, `BLACK`, `RED`, `BF_BLUE_BRIGHT`, `BF_RED_DARK`, etc.) frozen for runtime safety.
- **Zero-Allocation Bridging** – Seamless conversion to/from engine native `mod.Vector` (`toVector`, `fromVector`) and spatial `Vectors.Vector3` (`toVector3`, `fromVector3`).

### Examples

#### 1. Creating and Manipulating Colors

```ts
import { Colors } from 'bf6-portal-utils/colors';

// Parse from Hex
const orange = Colors.fromHex('#FF8361'); // { r: 1.0, g: 0.5137, b: 0.3804 }
const cyan = Colors.fromHex('00FFFF'); // { r: 0, g: 1, b: 1 }

// Convert back to Hex
const hexString = Colors.toHex(orange); // '#FF8361'

// Zero-allocation linear interpolation
const scratchColor: Colors.Color = { r: 0, g: 0, b: 0 };
Colors.lerp(Colors.RED, Colors.BLUE, 0.5, scratchColor);
```

#### 2. Color Tinting and Scaling

```ts
import { Colors } from 'bf6-portal-utils/colors';

const baseColor = Colors.fromHex('#D5EBF9');
const tintColor = { r: 1.0, g: 0.8, b: 0.8 };

// Element-wise modulation (Hadamard product)
const tinted = Colors.tint(baseColor, tintColor);

// Brightness multiplier
const dimColor = Colors.multiply(baseColor, 0.5);
```

#### 3. Interoperability with Engine and Vectors

```ts
import { Colors } from 'bf6-portal-utils/colors';
import { Vectors } from 'bf6-portal-utils/vectors';

const color = Colors.RED;

// Bridge to engine native vector
const modVec = Colors.toVector(color); // mod.CreateVector(1, 0, 0)

// Bridge to spatial Vector3
const vec3: Vectors.Vector3 = Colors.toVector3(color); // { x: 1, y: 0, z: 0 }
```

---

## Module: events

This TypeScript `Events` namespace provides a centralized event subscription system for Battlefield Portal experience developers. In Battlefield Portal, each event handler function (like `OnPlayerDeployed`, `OngoingPlayer`, etc.) can only be implemented and exported once per entire project. This module implements all event handlers once, automatically hooking into every Battlefield Portal event, and exposes an API that allows you to subscribe to and unsubscribe from any event from multiple places in your codebase. This keeps your code clean, modular, and maintainable.

> **Note** Do not implement or export any Battlefield Portal event handler functions in your codebase. This module handles all event hooking automatically and it owns all those hooks.

### Example

```ts
import { Events } from 'bf6-portal-utils/events';

// Optional: Configure error logging for handler failures
Events.setLogging((text) => console.log(text), Events.LogLevel.Warning, true);

// Subscribe to player deployment events
function handlePlayerDeployed(player: mod.Player): void {
    console.log(`Player ${mod.GetObjId(player)} deployed`);
}

// Subscribe to player death events with async handler
async function handlePlayerDied(
    player: mod.Player,
    otherPlayer: mod.Player,
    deathType: mod.DeathType,
    weaponUnlock: mod.WeaponUnlock
): Promise<void> {
    // Async operations are fully supported
    await mod.Wait(0.1);
    console.log(`Player ${mod.GetObjId(player)} died`);
}

// Subscribe to ongoing player events
function handleOngoingPlayer(player: mod.Player): void {
    // This will be called every tick for every player
    const health = mod.GetSoldierState(player, mod.SoldierStateNumber.Health);

    if (health < 10) {
        // Low health logic
    }
}

// Set up subscriptions at module load time (top-level code)
const unsubscribeDeployed = Events.OnPlayerDeployed.subscribe(handlePlayerDeployed);
const unsubscribeDied = Events.OnPlayerDied.subscribe(handlePlayerDied);
const unsubscribeOngoing = Events.OngoingPlayer.subscribe(handleOngoingPlayer);

// Optional: Clean up subscriptions when the game mode ends
Events.OnGameModeEnding.subscribe(() => {
    unsubscribeDeployed();
    unsubscribeDied();
    unsubscribeOngoing();
});
```

```ts
import { Events, EventPriority } from 'bf6-portal-utils/events';

// Channel style (preferred)
const joinGameUnsubscribe = Events.OnPlayerJoinGame.subscribe((player: mod.Player) => {
    console.log(`Player joined game: ${mod.GetObjId(player)}`);
});
// Later, unsubscribe
joinGameUnsubscribe();

// Subscribe with priority
Events.OngoingGlobal.subscribe(() => {
    console.log('Runs before normal and late handlers');
}, EventPriority.First);

Events.OngoingGlobal.subscribe(() => {
    console.log('Runs after all game logic handlers (e.g. flushing UI dirty states)');
}, EventPriority.Last);

// Object style
const playerDeployedUnsubscribe = Events.subscribe(
    Events.Type.OnPlayerDeployed,
    (player: mod.Player) => {
        console.log(`Player deployed: ${mod.GetObjId(player)}`);
    },
    EventPriority.Normal
);
// Later, unsubscribe
playerDeployedUnsubscribe();
```

```ts
const handler = (player: mod.Player) => console.log(`Player deployed: ${mod.GetObjId(player)}`);

// Channel style (preferred)
Events.OnPlayerDeployed.subscribe(handler);
// Later...
Events.OnPlayerDeployed.unsubscribe(handler);

// Object style
Events.subscribe(Events.Type.OnPlayerDeployed, handler);
// Later...
Events.unsubscribe(Events.Type.OnPlayerDeployed, handler);
```

#### Trigger

Manually triggers an event with the given parameters. Primarily useful for debugging or testing. In normal operation, events are automatically triggered by the Battlefield Portal runtime when the corresponding game events occur.

**Channel style:**

- **Signature:** `Events.<EventName>.trigger(...args): void`
- **Parameters:** `...args` – The parameters matching this event's signature (e.g. for `OnPlayerDeployed`: `player`).

**Enum style:**

- **Signature:** `Events.trigger<T extends Type>(type: T, ...args: EventParameters<T>): void`
- **Parameters:** `type` – The event type from `Events.Type` (trigger function for that event); `...args` – The parameters matching the event type's signature.

**Examples:**

```ts
const testPlayer = mod.ValueInArray(mod.AllPlayers(), 0) as mod.Player;

// Channel style (preferred)
Events.OnPlayerDeployed.trigger(testPlayer);

// Object style
Events.trigger(Events.Type.OnPlayerDeployed, testPlayer);
```

```ts
// Channel style (preferred)
Events.OnPlayerDeployed.subscribe(someHandler);
Events.OnPlayerDeployed.handlerCount(); // 1

// Object style
Events.subscribe(Events.Type.OnPlayerDeployed, someOtherHandler);
Events.handlerCount(Events.Type.OnPlayerDeployed); // 2
```

#### `Events.Type`

An object mapping each event name to its trigger function (e.g. `Events.Type.OnPlayerDeployed`). Use these values with the object-style API: `Events.subscribe(type, handler)`, `Events.unsubscribe(type, handler)`, `Events.trigger(type, ...args)`, and `Events.handlerCount(type)`. You can also use it for typed references to event payloads (e.g. `Parameters<typeof Events.Type.OnPlayerDied>`) or to call a trigger by name (e.g. `Events.Type.OnPlayerDeployed(somePlayer)`).

**Example (typed payload / dynamic dispatch):**

```ts
import { Events } from 'bf6-portal-utils/events';

// Typed payload for OnPlayerDied
type OnPlayerDiedPayload = Parameters<typeof Events.Type.OnPlayerDied>;
// [player: mod.Player, otherPlayer: mod.Player, deathType: mod.DeathType, weaponUnlock: mod.WeaponUnlock]

// Call a trigger by name (mostly for debugging or testing).
Events.Type.OnPlayerDeployed(somePlayer);
```

Available event types include:

- **Tick & Ongoing Loops**
    - _Tick Loops:_ `OngoingGlobal` (alias: `OnTickStart`), `OnTickEnd`
    - _Entity Ongoing:_ `OngoingAreaTrigger`, `OngoingBlockingSphere`, `OngoingBomb`, `OngoingCapturePoint`, `OngoingEmplacementSpawner`, `OngoingHQ`, `OngoingInteractPoint`, `OngoingLootSpawner`, `OngoingMCOM`, `OngoingPlayer`, `OngoingRingOfFire`, `OngoingSector`, `OngoingSpawner`, `OngoingSpawnPoint`, `OngoingTeam`, `OngoingVehicle`, `OngoingVehicleSpawner`, `OngoingWaypointPath`, `OngoingWorldIcon`
- **Player Lifecycle, Combat & Interaction**
    - _Session & Spawning:_ `OnPlayerJoinGame`, `OnPlayerLeaveGame`, `OnPlayerSwitchTeam`, `OnPlayerDeployed`, `OnPlayerUndeploy`
    - _Health & Combat:_ `OnPlayerDamaged`, `OnMandown`, `OnRevived`, `OnPlayerDied`, `OnPlayerEarnedKill`, `OnPlayerEarnedKillAssist`
    - _UI & Interaction:_ `OnPlayerInteract`, `OnPlayerUIButtonEvent`
- **Player Environment & Volumes**
    - _Triggers & Points:_ `OnPlayerEnterAreaTrigger`, `OnPlayerExitAreaTrigger`, `OnPlayerEnterCapturePoint`, `OnPlayerExitCapturePoint`
    - _Water:_ `OnPlayerEnteredWater`, `OnPlayerExitedWater`, `OnPlayerSubmerged`, `OnPlayerEmerged`
    - _Hazards:_ `OnPlayerEnterVL7Cloud`, `OnPlayerExitVL7Cloud`
- **Vehicles**
    - _Boarding & Seating:_ `OnPlayerEnterVehicle`, `OnPlayerExitVehicle`, `OnPlayerEnterVehicleSeat`, `OnPlayerExitVehicleSeat`
    - _Lifecycle:_ `OnVehicleSpawned`, `OnVehicleDestroyed`
- **Game Modes & Objectives**
    - _Match Flow:_ `OnGameModeStarted`, `OnGameModeEnding`, `OnTimeLimitReached`
    - _Capture Points:_ `OnCapturePointCapturing`, `OnCapturePointCaptured`, `OnCapturePointLost`
    - _MCOM / Rush:_ `OnMCOMArmed`, `OnMCOMDefused`, `OnMCOMDestroyed`
    - _Bomb / Delivery:_ `OnBombPickedUp`, `OnBombDropped`, `OnBombStateChanged`
    - _Ring of Fire:_ `OnRingOfFireZoneSizeChange`
- **AI & Bots**
    - _Movement:_ `OnAIMoveToRunning`, `OnAIMoveToSucceeded`, `OnAIMoveToFailed`
    - _Parachuting:_ `OnAIParachuteRunning`, `OnAIParachuteSucceeded`
    - _Waypoints:_ `OnAIWaypointIdleRunning`, `OnAIWaypointIdleSucceeded`, `OnAIWaypointIdleFailed`
- **Gadgets, Physics & World**
    - _Portal Gadget:_ `OnPortalGadgetAimStart`, `OnPortalGadgetAimStop`, `OnPortalGadgetFireStart`, `OnPortalGadgetFireStop`, `OnPortalGadgetLaserToggle`
    - _Raycasting:_ `OnRayCastHit`, `OnRayCastMissed`
    - _Spawners:_ `OnSpawnerSpawned`
    - _Map Specific:_ `OnGolmudTrainStopped`

```ts
import { Events } from 'bf6-portal-utils/events';

// Configure logging with console.log, minimum level of Warning, and include error details
Events.setLogging(
    (text) => console.log(text),
    Events.LogLevel.Warning,
    true // includeRawError
);

// If a handler throws an error, it will be logged automatically
Events.OnPlayerDeployed.subscribe((player: mod.Player) => {
    // If this throws, it will be logged as: <Events> Error in handler handleDeployment: [error details]
    throw new Error('Something went wrong');
});
```

## Usage Patterns

- **Modular Event Handling** – Split your event handling logic across multiple files or modules. Each module can subscribe to the events it needs without conflicts.

- **Conditional Subscriptions** – Subscribe and unsubscribe handlers dynamically based on game state. For example, only subscribe to vehicle events when vehicles are enabled.

- **Multiple Handlers per Event** – Subscribe multiple handlers to the same event to handle different concerns separately (e.g., one handler for logging, another for game logic, another for UI updates).

- **Async Operations** – Use async handlers for operations that require waiting, such as delayed actions or sequential operations.

- **Error Handling** – Since errors in handlers are isolated, you can add try-catch blocks within individual handlers for fine-grained error handling without affecting other subscriptions.

### Advanced Example

This example demonstrates how multiple modules across different files can subscribe to the same events independently, highlighting the key benefit of the Events system. Each module handles its own concerns without conflicts.

**File: `src/stats/player-stats.ts`**

```ts
import { Events } from 'bf6-portal-utils/events';

// Player statistics tracking module
class PlayerStats {
    private kills = new Map<number, number>();
    private deaths = new Map<number, number>();

    private unsubscribeFunctions: (() => void)[] = [];

    public constructor() {
        // Subscribe to player events for stats tracking
        this.unsubscribeFunctions.push(Events.OnPlayerEarnedKill.subscribe(this.handleKill.bind(this)));
        this.unsubscribeFunctions.push(Events.OnPlayerDied.subscribe(this.handleDeath.bind(this)));
        this.unsubscribeFunctions.push(Events.OnPlayerLeaveGame.subscribe(this.handleLeave.bind(this)));
    }

    private handleKill(
        player: mod.Player,
        otherPlayer: mod.Player,
        deathType: mod.DeathType,
        weaponUnlock: mod.WeaponUnlock
    ): void {
        const playerId = mod.GetObjId(player);
        this.kills.set(playerId, (this.kills.get(playerId) || 0) + 1);
    }

    private handleDeath(
        player: mod.Player,
        otherPlayer: mod.Player,
        deathType: mod.DeathType,
        weaponUnlock: mod.WeaponUnlock
    ): void {
        const playerId = mod.GetObjId(player);
        this.deaths.set(playerId, (this.deaths.get(playerId) || 0) + 1);
    }

    private handleLeave(playerId: number): void {
        this.kills.delete(playerId);
        this.deaths.delete(playerId);
    }

    public getKills(player: mod.Player): number {
        return this.kills.get(mod.GetObjId(player)) || 0;
    }

    public getDeaths(player: mod.Player): number {
        return this.deaths.get(mod.GetObjId(player)) || 0;
    }

    public cleanup(): void {
        this.unsubscribeFunctions.forEach((unsub) => unsub());
    }
}

let stats: PlayerStats;

Events.OnGameModeStarted.subscribe(() => {
    stats = new PlayerStats();
});

Events.OnGameModeEnding.subscribe(() => {
    stats?.cleanup();
});
```

**File: `src/logging/game-logger.ts`**

```ts
import { Events } from 'bf6-portal-utils/events';

// Game event logging module - subscribes to the SAME events as PlayerStats
class GameLogger {
    private unsubscribeFunctions: (() => void)[] = [];

    public constructor() {
        // Multiple modules can subscribe to the same events!
        // This logger also listens to OnPlayerEarnedKill and OnPlayerDied
        this.unsubscribeFunctions.push(Events.OnPlayerEarnedKill.subscribe(this.logKill.bind(this)));
        this.unsubscribeFunctions.push(Events.OnPlayerDied.subscribe(this.logDeath.bind(this)));
        this.unsubscribeFunctions.push(Events.OnPlayerDeployed.subscribe(this.logDeployment.bind(this)));
        this.unsubscribeFunctions.push(Events.OnVehicleSpawned.subscribe(this.logVehicleSpawn.bind(this)));
    }

    private logKill(
        player: mod.Player,
        otherPlayer: mod.Player,
        deathType: mod.DeathType,
        weaponUnlock: mod.WeaponUnlock
    ): void {
        console.log(
            `[KILL] Player ${mod.GetObjId(player)} killed Player ${mod.GetObjId(otherPlayer)} with ${weaponUnlock}`
        );
    }

    private logDeath(
        player: mod.Player,
        otherPlayer: mod.Player,
        deathType: mod.DeathType,
        weaponUnlock: mod.WeaponUnlock
    ): void {
        console.log(`[DEATH] Player ${mod.GetObjId(player)} died`);
    }

    private logDeployment(player: mod.Player): void {
        console.log(`[DEPLOY] Player ${mod.GetObjId(player)} deployed`);
    }

    private logVehicleSpawn(vehicle: mod.Vehicle): void {
        console.log(`[VEHICLE] Vehicle ${mod.GetObjId(vehicle)} spawned`);
    }

    public cleanup(): void {
        this.unsubscribeFunctions.forEach((unsub) => unsub());
    }
}

let logger: GameLogger;

Events.OnGameModeStarted.subscribe(() => {
    logger = new GameLogger();
});

Events.OnGameModeEnding.subscribe(() => {
    logger?.cleanup();
});
```

**File: `src/index.ts`**

```ts
import { Events } from 'bf6-portal-utils/events';

// Main entry point - just import the modules, they handle their own subscriptions
import './stats/player-stats';
import './logging/game-logger';

// You can also subscribe to events directly in the main file
Events.OnGameModeStarted.subscribe(() => {
    console.log('Game mode started - all modules initialized');
});

// Multiple handlers for the same event work perfectly!
Events.OnPlayerDeployed.subscribe((player: mod.Player) => {
    // This handler runs alongside the HUD's handler
    console.log(`Main: Player ${mod.GetObjId(player)} deployed`);
});
```

This example demonstrates:

- **Multiple subscriptions to the same event** – `OnPlayerEarnedKill` is subscribed to by `PlayerStats` and `GameLogger`, and all handlers execute independently.

- **Modular code organization** – Each module manages its own subscriptions without knowing about other modules.

- **No conflicts** – All modules can subscribe to any event without interfering with each other.

- **Clean separation of concerns** – Stats tracking, logging, and UI updates are handled in separate files but all respond to the same game events.

## Known Limitations & Caveats

- **Single Event Hook Requirement** – You must not implement or export any Battlefield Portal event handler functions in your own code. If you do, they will conflict with this module's implementations and cause undefined behavior.

- **Handler Reference Equality** – When unsubscribing, you must pass the exact same function reference that was used in `subscribe()`. Anonymous functions cannot be unsubscribed unless you store the reference. **Recommended:** Use the unsubscribe function returned by `subscribe()` instead of storing handler references.

- **Execution Order** – Handlers execute in ascending order of their priority (`First` $\to$ `Normal` $\to$ `Last` or custom numbers). Handlers with the same priority value execute in deterministic FIFO order (the order in which they were subscribed).

- **No Return Values** – Event handlers cannot return values to the caller. All handlers return `void` or `Promise<void>`. If you need to collect results, use shared state or callbacks.

- **Completion and Ordering** – Synchronous handlers complete before the trigger returns; asynchronous handlers are not awaited, so you cannot rely on async handlers finishing before other code runs. Long-running synchronous handlers block other handlers and the caller—prefer async handlers for non-trivial work. Use promises or callbacks if you need to wait for handler completion.

- **Tick Budget (~50ms)** – The server may abort the JavaScript process for a game tick if total work exceeds its per-tick cap, leading to incomplete event executions. This is mechanism has since been disabled, but the module will still log how many triggers did not complete per event type over a rolling window; see [Tick Budget and Incomplete Triggers](#tick-budget-and-incomplete-triggers) for details and mitigation.

---

## Module: ffa-drop-ins

The TypeScript `FFADropIns` class enables Free For All (FFA) spawning for custom Battlefield Portal experiences by short-circuiting the normal deploy process in favor of a custom UI prompt with developer-curated drop-in spawn points. The system asks players if they would like to spawn now or be asked again after a delay, allowing players to adjust their loadout and settings at the deploy screen without being locked out.

The spawning system accepts an arbitrary region of individual rectangles and an altitude. It uses a high-performance **Structure of Arrays (SoA)** memory layout with typed arrays (`Float32Array`) to precompute area weights and generate pre-created drop-in spawn points upfront with zero per-frame heap churn.

> **Note:** Since this module imports and relies on `Events`, **you must use the `Events` module as your only mechanism to subscribe to game events**—do not implement or export any Battlefield Portal event handler functions in your own code. See the [Events module](../events/README.md#known-limitations--caveats).

### Example

```ts
import { FFADropIns } from 'bf6-portal-utils/ffa-drop-ins';
import { Events } from 'bf6-portal-utils/events';

// Define your drop-in region: rectangles (minX, minZ, maxX, maxZ) and altitude (y)
const DROP_IN_REGION: FFADropIns.SpawnData = {
    spawnRectangles: [
        { minX: -200, minZ: -200, maxX: 200, maxZ: 200 }, // First area
        { minX: 300, minZ: 100, maxX: 500, maxZ: 300 }, // Second area
    ],
    y: 300, // Altitude for drop-in (players spawn in the air and skydive until they open their parachute)
};

let spawner: FFADropIns;

Events.OnGameModeStarted.subscribe(() => {
    // Instantiate the drop-in spawning system
    spawner = new FFADropIns(DROP_IN_REGION, {
        dropInPoints: 64, // Optional (default 64) – number of spawn points to pre-create
        initialPromptDelay: 10, // Optional (default 10 seconds)
        promptDelay: 10, // Optional (default 10 seconds)
        queueProcessingDelay: 2, // Optional (default 2 seconds)
    });

    // Enable spawn queue processing
    spawner.enableSpawnQueueProcessing();

    // Optional: Configure logging
    FFADropIns.setLogging((text) => console.log(text), FFADropIns.LogLevel.Info);
});

Events.OnPlayerJoinGame.subscribe((eventPlayer: mod.Player) => {
    // Add player to drop-in spawning system and start delay countdown
    spawner.addPlayer(eventPlayer, false);
    spawner.startDelayForPrompt(eventPlayer);
});

Events.OnPlayerUndeploy.subscribe((eventPlayer: mod.Player) => {
    // Start delay countdown when a player undeploys
    spawner.startDelayForPrompt(eventPlayer);
});
```

## Debugging & Development Tools

### Debug Position Display

The `spawner.addPlayer()` method accepts an optional `showDebugPosition` parameter (default: `false`) that enables a real-time position display for developers. When enabled, the player's X, Y, and Z coordinates are displayed at the bottom center of the screen, updating every second.

**Use Case**: Useful for finding and documenting drop-in regions and altitude (e.g. flying around to set rectangle bounds and `y`).

**Coordinate Format**: Coordinates are scaled by 100 and truncated (using integer truncation) to avoid Portal's decimal display issues. Divide the displayed value by 100 to get actual world coordinates.

**Example Usage**:

```ts
Events.OnPlayerJoinGame.subscribe((eventPlayer: mod.Player) => {
    spawner.addPlayer(eventPlayer, mod.GetObjId(eventPlayer) === 0);
    spawner.startDelayForPrompt(eventPlayer);
});
```

---

## Module: ffa-spawn-points

The TypeScript `FFASpawnPoints` class enables Free For All (FFA) spawning for custom Battlefield Portal experiences by short-circuiting the normal deploy process in favor of a custom UI prompt with developer-curated fixed spawn points. The system asks players if they would like to spawn now or be asked again after a delay, allowing players to adjust their loadout and settings at the deploy screen without being locked out.

The spawning system uses a high-performance **Structure of Arrays (SoA)** memory layout with typed arrays (`Float32Array`, `Float64Array`, `Uint16Array`) and an exhaustive, zero-allocation multi-factor fitness scoring algorithm powered by [`PlayerLocations`](../player-locations/README.md). It evaluates enemy proximity, sector crowding, temporal cooldowns, and forward facing alignment in JavaScript memory with **zero C++ engine foreign function interface (FFI) calls**.

> **Note:** Since this module imports and relies on `Events`, **you must use the `Events` module as your only mechanism to subscribe to game events**—do not implement or export any Battlefield Portal event handler functions in your own code. See the [Events module](../events/README.md#known-limitations--caveats).

### Example

```ts
import { FFASpawnPoints } from 'bf6-portal-utils/ffa-spawn-points';
import { Events } from 'bf6-portal-utils/events';

// Define your spawn points: [x, y, z, orientationDegrees]
const SPAWN_POINTS: FFASpawnPoints.SpawnData[] = [
    [100, 0, 200, 0], // x = 100, y = 0, z = 200, orientation = 0 (North)
    [-100, 0, 200, 90], // x = -100, y = 0, z = 200, orientation = 90 (East)
    [0, 0, -200, 180], // x = 0, y = 0, z = -200, orientation = 180 (South)
    [-200, 100, 300, 270], // x = -200, y = 100, z = 300, orientation = 270 (West)
    // ... more spawn points
];

let spawner: FFASpawnPoints;

Events.OnGameModeStarted.subscribe(() => {
    // Instantiate the spawning system with custom fitness options
    spawner = new FFASpawnPoints(SPAWN_POINTS, {
        defaultScorerOptions: {
            minSafeDistance: 20, // Disqualify/penalize enemies closer than 20m (default: 20m)
            idealDistance: 35, // Peak fitness distance to closest enemy (default: 35m)
            maxDistance: 80, // Far distance cutoff where proximity score drops to 0 (default: 80m)
            crowdingRadius: 50, // Sector radius to evaluate crossfire risk (default: 50m)
            crowdingWeight: 0.25, // Penalty per extra enemy in crowding sector (default: 0.25)
            spawnCooldownMs: 4000, // Cooldown before a spawn point regains full fitness (default: 4000ms)
            facingWeight: 0.15, // Bonus when spawn orientation faces towards action (default: 0.15)
        },
        selectionPoolSize: 3, // Randomly pick from Top-3 candidates to prevent clustering (default: 3)
        initialPromptDelay: 10, // Delay before first prompt in seconds (default: 10)
        promptDelay: 10, // Delay between prompts in seconds (default: 10)
        queueProcessingDelay: 1, // Queue processing interval in seconds (default: 1)
    });

    // Enable spawn queue processing
    spawner.enableSpawnQueueProcessing();

    // Optional: Configure logging for spawn system debugging
    FFASpawnPoints.setLogging((text) => console.log(text), FFASpawnPoints.LogLevel.Info);
});

Events.OnPlayerJoinGame.subscribe((eventPlayer: mod.Player) => {
    // Add player to spawning system and start delay countdown
    spawner.addPlayer(eventPlayer, false);
    spawner.startDelayForPrompt(eventPlayer);
});

Events.OnPlayerUndeploy.subscribe((eventPlayer: mod.Player) => {
    // Start delay countdown when a player undeploys
    spawner.startDelayForPrompt(eventPlayer);
});
```

## Debugging & Development Tools

### Debug Position Display

The `spawner.addPlayer()` method accepts an optional `showDebugPosition` parameter (default: `false`) that enables a real-time position display for developers. When enabled, the player's X, Y, and Z coordinates are displayed at the bottom center of the screen, updating every second.

**Use Case**: Useful for finding and documenting drop-in regions and altitude (e.g. flying around to set rectangle bounds and `y`).

**Coordinate Format**: Coordinates are scaled by 100 and truncated (using integer truncation) to avoid Portal's decimal display issues. Divide the displayed value by 100 to get actual world coordinates.

**Example Usage**:

```ts
Events.OnPlayerJoinGame.subscribe((eventPlayer: mod.Player) => {
    spawner.addPlayer(eventPlayer, mod.GetObjId(eventPlayer) === 0);
    spawner.startDelayForPrompt(eventPlayer);
});
```

---

## Module: interleaved-quaternions

The `InterleavedQuaternions` namespace provides low-level, high-performance utilities for working with contiguous Structure of Arrays (SoA) in flat `Float32Array` buffers for 4D Hamiltonian quaternions (stride 4: `w, x, y, z`) in Battlefield 6 Portal experiences.

In the memory-constrained Battlefield Portal QuickJS environment, managing hundreds of discrete JavaScript quaternion objects causes heap fragmentation and garbage collection pressure. By storing 4D quaternions contiguously inside flat TypedArrays, memory overhead is minimized and spatial cache locality is maximized.

Key features include:

- **Zero-Allocation Operations** – All read, write, and math functions operate directly on pre-allocated `Float32Array` buffers with zero runtime object allocations.
- **4D Quaternion Stride 4 Helpers** – Fast cloning and extraction (`toQuaternion`), writing (`toSlice`, `copySlice`), identity initialization (`setIdentity`), direct array-to-array Hamilton quaternion multiplication (`multiplyToSlice`), dot products (`dotSliceAndQuaternion`), length queries (`lengthSquared`), and equality testing (`equalsQuaternion`).
- **Uniform API Standard** – Shared across `Spatial` and other performance-critical modules in `bf6-portal-utils`.

---

## Module: interleaved-vectors

The `InterleavedVectors` namespace provides low-level, high-performance utilities for working with contiguous Structure of Arrays (SoA) in flat `Float32Array` buffers for 3D vector coordinates (stride 3: `x, y, z`) in Battlefield 6 Portal experiences.

In the memory-constrained Battlefield Portal QuickJS environment, managing hundreds of discrete JavaScript vector objects causes heap fragmentation and garbage collection pressure. By storing 3D coordinates contiguously inside flat TypedArrays, memory overhead is minimized and spatial cache locality is maximized.

Key features include:

- **Zero-Allocation Operations** – All read, write, and math functions operate directly on pre-allocated `Float32Array` buffers with zero runtime object allocations.
- **3D Vector Stride 3 Helpers** – Fast copying (`toVector`, `toSlice`, `copySlice`), uniform/component setting (`setSlice`), addition (`addSliceAndVectorToSlice`, `addVectorsToSlice`, `addSliceAndVectorToVector`, `addScaledSliceOntoSlice`), subtraction (`subtractVectorFromSliceToVector`), scalar multiplication (`multiplyVectorToSlice`), in-place scaling (`scaleSlice`), dot products (`dotSlices`, `dotSliceAndVector`), Euclidean lengths (`length`, `lengthSquared`), distance queries (`sliceToSliceDistanceSquared`, `sliceToVectorDistanceSquared`), cross products (`crossToSlice`, `crossToVector`), normalization (`normalizeToVector`), Hadamard multiplication (`hadamardMultiplyToSlice`, `hadamardMultiplyToVector`), safe Hadamard division (`safeHadamardDivideVectorBySliceToVector`), and equality testing (`equalsVector`).
- **Uniform API Standard** – Shared across `Spatial`, `Physics`, and other performance-critical modules in `bf6-portal-utils`.

---

## Module: logger

This TypeScript `Logger` class removes the biggest Battlefield Portal debugging pain point: until now you could only display strings that were pre-uploaded to the Experience website via a `strings.json` file, and displaying concatenated strings with more than 3 parts was tricky, if not impossible. Further, `console.log` is only available for PC users, with a file written to their filesystem. By pairing a lightweight UI window with the `logger.strings.json` character map, this module lets you log any runtime text (errors, telemetry, formatted data, etc.) directly to the screen, even on console builds.

- **Dynamic mode** behaves like a scrolling console, always appending at the bottom and pushing older rows upward.
- **Static mode** lets you target a specific row index (e.g., keep player position on row 10 while other diagnostics fill lines 0‑9).

> **Note:** Since this module imports and relies on `Events`, **you must use the `Events` module as your only mechanism to subscribe to game events**—do not implement or export any Battlefield Portal event handler functions in your own code. See the [Events module](../events/README.md#known-limitations--caveats).

## Usage Patterns

- **Static dashboards** – Pin persistent diagnostics (positions, squad metadata, timers) to precise rows. Multiple writes to the same row in a single tick overwrite each other with zero intermediate rendering overhead.
- **Dynamic consoles** – Stream verbose traces (button clicks, state transitions, error stacks) without worrying about pre-provisioned strings.
- **Multiple Instances** – Keep both modes active: e.g., static logger on the left for gauges, dynamic logger on the right for realtime traces.
- **Zero-Allocation Batching Pipeline** – All `log()` calls are non-blocking and automatically batched in memory until `Events.OnTickEnd` (priority 90). The entire batch is rendered in a single pass right before `UI.flush()` (priority 100), eliminating intermediate layout and text measuring costs.

### Example

```ts
import { Logger } from 'bf6-portal-utils/logger';
import { UI } from 'bf6-portal-utils/ui';

let staticLogger: Logger | undefined;
let dynamicLogger: Logger | undefined;

export async function OnPlayerDeployed(eventPlayer: mod.Player): Promise<void> {
    if (!staticLogger) {
        staticLogger = new Logger(eventPlayer, {
            staticRows: true,
            visible: true,
            anchor: UI.Anchor.TopLeft,
            width: 600,
        });
        dynamicLogger = new Logger(eventPlayer, { staticRows: false, visible: true, anchor: UI.Anchor.TopRight });
    }

    dynamicLogger?.log(`Player: ${mod.GetObjId(player)}`);
    dynamicLogger?.log(`Team: ${mod.GetObjId(mod.GetTeam(player))}`);
    dynamicLogger?.log(`Hello @ world $${(12345.6789).toFixed(2)}!!`);

    while (true) {
        const position = mod.GetObjectPosition(player);

        const x = mod.XComponentOf(position).toFixed(2);
        const y = mod.YComponentOf(position).toFixed(2);
        const z = mod.ZComponentOf(position).toFixed(2);

        staticLogger?.log(`Position: <${x},${y},${z}>`, 13);

        await mod.Wait(0.5);

        if (!mod.GetSoldierState(player, mod.SoldierStateBool.IsReloading)) continue;
    }
}
```

---

## Module: logging

This TypeScript `Logging` class provides a fail-safe logging abstraction for Battlefield Portal experience developers. It abstracts away the logic to log text and errors to an arbitrary logging function in a fail-safe way, with configurable log level filtering. The class can be used directly within a BF6 Portal experience or can be used within other modules to provide consistent, safe logging functionality.

Key features include fail-safe error handling that prevents logging failures from crashing your mod, configurable log level filtering to control verbosity, optional error message inclusion in the formatted text, support for both synchronous and asynchronous logging functions, automatic error-to-string conversion for that suffix, and a **second callback argument** so your logging function receives the raw `error` value from `log()` (for example `instanceof Error` checks and `stack` access) independent of `includeRawError`.

### Example: Direct Usage in Portal Experience

```ts
import { Logging } from 'bf6-portal-utils/logging';

const logging = new Logging('MyMod');

export async function OnGameModeStarted(): Promise<void> {
    // Set up logging with console.log, minimum log level of Warning, and include error messages in the text.
    logging.setLogging((text) => console.log(text), Logging.LogLevel.Warning, true);

    // Log an info message
    logging.log('Game mode started', Logging.LogLevel.Info); // Won't be logged

    if (!someCheck()) {
        // Log an warning message
        logging.log('Some check failed', Logging.LogLevel.Warning);
    }

    // Log an error with an error object
    try {
        someRiskyOperation();
    } catch (error) {
        logging.log('Failed to perform operation', Logging.LogLevel.Error, error);
    }

    // Debug messages won't be logged if log level is Warning or higher
    logging.log('Debug information', Logging.LogLevel.Debug); // Won't be logged
}
```

### Example: Usage Within a Module

```ts
import { Logging } from '../logging';

export namespace MyModule {
    const logging = new Logging('MyModule');

    // Re-export LogLevel enum for convenience for controlling logging verbosity.
    export const LogLevel = Logging.LogLevel;

    export function setLogging(
        log?: (text: string, error?: unknown) => Promise<void> | void,
        logLevel?: Logging.LogLevel,
        includeRawError?: boolean
    ): void {
        logging.setLogging(log, logLevel, includeRawError);
    }

    export function doSomething(): void {
        logging.log('Doing something', Logging.LogLevel.Info);
    }

    export function trySomething(): void {
        try {
            somethingThatMightFail();
        } catch (error: unknown) {
            logging.log('Something failed', Logging.LogLevel.Error, error);
        }
    }
}

// Usage in experience:
// MyModule.setLogging((text) => console.log(text), MyModule.LogLevel.Info);
```

## Usage Patterns

### Basic Logging

```ts
import { Logging } from 'bf6-portal-utils/logging';

const logging = new Logging('MyMod');

export async function OnGameModeStarted(): Promise<void> {
    // Set up logging (second callback arg is omitted when log() had no error)
    logging.setLogging((text) => console.log(text), Logging.LogLevel.Info);

    // Log messages at different levels
    logging.log('Debug message', Logging.LogLevel.Debug); // Won't be logged (below Info)
    logging.log('Info message', Logging.LogLevel.Info); // Will be logged
    logging.log('Warning message', Logging.LogLevel.Warning); // Will be logged
    logging.log('Error message', Logging.LogLevel.Error); // Will be logged
}
```

### Error Logging

```ts
import { Logging } from 'bf6-portal-utils/logging';

const logging = new Logging('MyMod');

export async function OnGameModeStarted(): Promise<void> {
    // includeRawError: append a safe string form to `text`; second arg is always the raw value from log()
    logging.setLogging(
        (text, err) => {
            console.log(text);

            if (err instanceof Error) {
                console.log(err.stack ?? err);
            }
        },
        Logging.LogLevel.Warning,
        true // also append " - Error: …" to `text`
    );

    try {
        riskyOperation();
    } catch (error) {
        logging.log('Operation failed', Logging.LogLevel.Error, error);
    }
}
```

### Conditional Logging with `willLog()`

```ts
import { Logging } from 'bf6-portal-utils/logging';

const logging = new Logging('MyMod');

export async function OnGameModeStarted(): Promise<void> {
    logging.setLogging((text) => console.log(text), Logging.LogLevel.Warning); // error param omitted when unused

    // Avoid expensive string building if logging won't occur
    if (logging.willLog(Logging.LogLevel.Debug)) {
        const expensiveData = buildExpensiveDebugString();
        logging.log(expensiveData, Logging.LogLevel.Debug);
    }
}
```

### Async Logger Functions

```ts
import { Logging } from 'bf6-portal-utils/logging';

const logging = new Logging('MyMod');

async function asyncLogger(text: string, error?: unknown): Promise<void> {
    // Simulate async logging (e.g., sending to external service)
    await someAsyncLoggingService.log(text, error);
}

export async function OnGameModeStarted(): Promise<void> {
    // Async loggers are fully supported
    logging.setLogging(asyncLogger, Logging.LogLevel.Info);

    // If the async logger rejects, it's caught and logged to console
    logging.log('This will be sent async', Logging.LogLevel.Info);
}
```

### Disabling Logging

```ts
import { Logging } from 'bf6-portal-utils/logging';

const logging = new Logging('MyMod');

export async function OnGameModeStarted(): Promise<void> {
    // Initially enable logging
    logging.setLogging((text) => console.log(text), Logging.LogLevel.Info);

    logging.log('This will be logged', Logging.LogLevel.Info);

    // Disable logging by passing undefined (or null)
    logging.setLogging(null);

    logging.log('This will not be logged', Logging.LogLevel.Info);
}
```

## Known Limitations & Caveats

- **Error String Conversion vs Raw Value** – The suffix appended to `text` when `includeRawError` is true uses `_safeErrorToString()` only (message for `Error`, else `String()`, with fallbacks). Rich fields are not serialized there. Use the callback’s second argument when you need the original thrown value, `Error.stack`, or custom error types.

- **Sinks That Only Accept Strings** – If your backend or UI logger cannot accept arbitrary `unknown` values, ignore the second parameter and rely on `text` only; set `includeRawError = true` if you need a short string summary on the line.

- **Async Logger Timing** – If a logger function returns a `Promise`, the `log()` method does not await it. The promise is handled in a fire-and-forget manner to prevent blocking. This means you cannot rely on the log operation completing before your code continues.

---

## Module: map-detector

This TypeScript `MapDetector` class enables Battlefield Portal experience developers to detect the current map by analyzing the coordinates of Team 1's Headquarters (HQ) or a custom spatial marker object. This utility is necessary because `mod.IsCurrentMap` from the official Battlefield Portal API is currently broken and unreliable.

### Example

```ts
import { MapDetector } from 'bf6-portal-utils/map-detector';
import { Events } from 'bf6-portal-utils/events';

// If your experience uses custom spatial data that moves HQ1 on certain maps, set the
// expected HQ1 coordinates for each affected map here (after imports, not in an event handler):
MapDetector.setCoordinates(MapDetector.Map.Downtown, { x: -1044, y: 122, z: 220 });
MapDetector.setCoordinates(MapDetector.Map.Eastwood, { x: -195, y: 231, z: -41 });

// Alternatively, if you use a spatial marker object placed at unique coordinates per map:
// MapDetector.setMarkerObjectId(123);

Events.OnGameModeStarted.subscribe(() => {
    // Optional: Configure logging for map detection debugging
    MapDetector.setLogging((text) => console.log(text), MapDetector.LogLevel.Warning);

    // Get the current map as a MapDetector.Map enum
    const map = MapDetector.currentMap();

    if (map == MapDetector.Map.Downtown) {
        // Handle Downtown-specific logic
    }

    if (map == MapDetector.Map.Eastwood) {
        // Handle Eastwood-specific logic
    }

    // Get the current map as a string
    const mapName = MapDetector.currentMapName();
    console.log(`Current map: ${mapName}`);
});
```

## Custom map spatial layouts

If your experience uses **custom spatial data** that moves Team 1's HQ from its default position on one or more maps, detection would otherwise fail. You have two options:

1. **Set Custom Coordinates** – Call **`MapDetector.setCoordinates(map, coordinates)`** for **each map** where HQ1 has a non-default position.
2. **Use a Spatial Marker Object** – Call **`MapDetector.setMarkerObjectId(id)`** to specify a spatial object ID whose position will be read via `mod.GetSpatialObject(id)` and matched against known map coordinates instead of HQ1.

Do this **at the top of your file** (after imports), **not** inside an event handler—your code does not know the current map until the detector runs, so you must pre-configure every map whose layout you have changed. Pass the (x, y, z) position for that layout; coordinates are rounded to integers and clamped to `[-32,768, 32,767]`. That is sufficient because positions differ widely between maps, so integer comparison is enough to distinguish them.

---

## Known Limitations

### Missing Maps in Native Enum

The map **"Bellum1988's Operation Metro"** is not available in the native `mod.Maps` enum (it is missing from the Battlefield Portal API). As a result:

- `MapDetector.currentNativeMap()` will return `null` for that map.
- `MapDetector.isCurrentNativeMap()` will always return `false` for that map when checking against any `mod.Maps` value.
- `MapDetector.currentMap()` and `MapDetector.isCurrentMap()` **behave correctly for that map**.

Use `MapDetector.Map` enum values and `isCurrentMap()` when working with that map (or for consistency, for all maps).

### Detection Method

The detector identifies maps by comparing the **integer parts** of the target position (Team 1's HQ by default, or the spatial marker object if `setMarkerObjectId()` is used) (x, y, z) to the known coordinates for each map; decimal parts are ignored. If custom spatial data has moved HQ1 on certain maps, call `setCoordinates()` at the top of your file for each affected map, or use `setMarkerObjectId()` so detection continues to work.

---

## Module: mod-extensions

The `ModExtensions` namespace provides helper functions for resolving opaque event payloads (such as `mod.DamageType`, `mod.DeathType`, and `mod.WeaponUnlock`) to their corresponding Battlefield Portal enum values (`mod.PlayerDamageTypes`, `mod.PlayerDeathTypes`, `mod.Gadgets`, and `mod.Weapons`).

### Example

```ts
import { ModExtensions } from 'bf6-portal-utils/mod-extensions';
import { Events } from 'bf6-portal-utils/events';

Events.OnPlayerDied.subscribe((event: mod.OnPlayerDiedEvent) => {
    // Resolve opaque event deathType to the PlayerDeathTypes enum value
    const deathType = ModExtensions.getPlayerDeathType(event.deathType);

    if (deathType === mod.PlayerDeathTypes.Headshot) {
        // Headshot-specific logic
    }
});

Events.OnPlayerDamaged.subscribe((event: mod.OnPlayerDamagedEvent) => {
    // Resolve opaque event damageType to the PlayerDamageTypes enum value
    const damageType = ModExtensions.getPlayerDamageType(event.damageType);

    if (damageType === mod.PlayerDamageTypes.Explosion) {
        // Explosion-specific logic
    }
});
```

---

## Module: multi-click-detector

This TypeScript `MultiClickDetector` class enables Battlefield Portal experience developers to detect when a player has rapidly triggered a soldier state multiple times in quick succession. The detector can monitor any soldier state boolean from `mod.SoldierStateBool`, allowing you to detect multi-click sequences for various player actions.

The detector tracks soldier state transitions for each player independently, counting rapid state changes within a configurable time window to determine when a multi-click sequence has been completed. Each detector instance is configured with runtime options (including which soldier state to monitor) and a callback that is triggered when a multi-click sequence is detected.

By default, the detector monitors `mod.SoldierStateBool.IsInteracting`, which is the most user-friendly option because the interact state goes `true` for 1 tick even when there is no object that can be interacted with nearby. This makes it ideal for detecting multi-click sequences without requiring physical interaction points, and is useful because there is no keybind Portal experience developers can hook into to open up a custom UI.

Key features include instance-based tracking via an ID system, **automatic event wiring** via the `Events` module (the detector subscribes to `OnTickStart`, `OnPlayerDeployed`, `OnPlayerUndeploy`, and `OnPlayerLeaveGame` internally), and configurable logging. Sampling soldier input states at the start of each frame (`Events.OnTickStart`) ensures responsive click detection before other event handlers run. Soldier state is only continuously read when the player is deployed, so the admin error log is not flooded. Each detector can be enabled or disabled independently. Callbacks can be sync or async; **asynchronous callbacks are preferred** because synchronous callbacks block the entire event stack. Keep sync callbacks short if you use them.

> **Note:** Since this module imports and relies on `Events`, **you must use the `Events` module as your only mechanism to subscribe to game events**—do not implement or export any Battlefield Portal event handler functions in your own code. See the [Events module](../events/README.md#known-limitations--caveats).

### Example

```ts
import { MultiClickDetector } from 'bf6-portal-utils/multi-click-detector';
import { Events } from 'bf6-portal-utils/events';

MultiClickDetector.setLogging((text) => console.log(text), MultiClickDetector.LogLevel.Error);

Events.OnPlayerJoinGame.subscribe((player: mod.Player) => {
    const playerId = mod.GetObjId(player);

    // Create a detector for this player. Event wiring is automatic.
    // Prefer async callbacks—sync callbacks block the entire OnTickStart event stack.
    const detectorId = MultiClickDetector.create(
        player,
        async () => {
            console.log(`Player ${playerId} performed multi-click!`);
            await openCustomMenu(player);
        },
        {
            soldierState: mod.SoldierStateBool.IsInteracting,
            windowMs: 1_000,
            requiredClicks: 3,
        }
    );
}
```

### Example: Multiple Detectors per Player

```ts
import { MultiClickDetector } from 'bf6-portal-utils/multi-click-detector';
import { Events } from 'bf6-portal-utils/events';

Events.OnPlayerJoinGame.subscribe((player: mod.Player) => {
    MultiClickDetector.create(player, () => openCustomMenu(player), {
        soldierState: mod.SoldierStateBool.IsSprinting,
        requiredClicks: 4,
        windowMs: 1_500,
    });

    MultiClickDetector.create(player, () => activateSpecialAbility(player), {
        soldierState: mod.SoldierStateBool.IsInteracting,
        requiredClicks: 3,
        windowMs: 1_000,
    });
});
```

### Example: Async callbacks (preferred)

```ts
import { MultiClickDetector } from 'bf6-portal-utils/multi-click-detector';
import { Events } from 'bf6-portal-utils/events';

Events.OnPlayerDeployed.subscribe((player: mod.Player) => {
    MultiClickDetector.create(player, async () => {
        await loadPlayerData(player);
        await openCustomUI(player);
    });
});
```

## Choosing a Soldier State

The detector can monitor any soldier state boolean from `mod.SoldierStateBool`, but not all states are equally suitable for multi-click detection. This section explains which states work best and why.

### Recommended: `IsInteracting` (Default)

**Why it's the best choice:**

- **No visual side effects** – When a player rapidly presses the interact key, the interact state goes `true` for 1 ticks even when there is no object or interaction points that can be interacted with nearby. This means players can perform multi-click sequences without any visual feedback or character movement, making it feel like a hidden input method.
- **No gameplay impact** – Unlike other states, rapid interact presses don't cause the player's character to perform any actions that could interfere with gameplay.
- **Caveat** - Players must have their `Interact` keybind set to `Tap`, not `Hold`.

**Use case:** Opening custom menus, triggering special abilities, or any action where you want a hidden input method that doesn't affect the player's character visually or mechanically.

### Secondary Options: `IsCrouching` and `IsSprinting`

**Why they work but have drawbacks:**

- **Rapid toggling is possible** – Both `IsCrouching` and `IsSprinting` can be rapidly toggled by players, making them technically viable for multi-click detection.
- **Visual jittering** – Rapidly toggling these states causes the player's character to visually jitter as it tries to crouch/stand or sprint/walk in quick succession. This can be distracting and may interfere with gameplay.
- **Gameplay impact** – The character actually performs these actions, which may not be desirable if you're just trying to detect input for a UI or special ability.
- **Benefit** - Unlike requiring players to ensure their `Interact` keybind set to `Tap`, it is more likely players can already quickly toggle `Sprint` or `Crouch` with their existing keybind settings.

**Use case:** Consider these if you need more than one multi-click detection (and you've already used the `IsInteracting` state), or if you are comfortable forcing players to physically jitter a bit, but not have to change their `Interact` keybind set to `Tap`.

- **Memory** – Detectors for a player are removed automatically when the player leaves. Hold a detector reference only if you need to call `enable()`, `disable()`, or `destroy()` yourself; otherwise you can create detectors without storing the return value.

---

## Module: performance-stats

The `PerformanceStats` namespace tracks server tick rate and script timeout lag and exposes getters suitable for real-time compute scaling or displaying smoothed metrics in a UI. When the game mode starts, it subscribes to `Events.OnTickStart` to record timestamps at the very beginning of each frame for accurate inter-tick delta calculations and starts a 1-second sampling window to compute smoothed tick rate (Hz) and lag (ms). When the server is under stress—e.g. timeout lag spikes over 100ms or tick rate drops below 25Hz—it logs warnings via the configured logger so you can see spikes in the UI or logs without polling raw values yourself.

> **Note:** Since this module imports and relies on `Events`, **you must use the `Events` module as your only mechanism to subscribe to game events**—do not implement or export any Battlefield Portal event handler functions in your own code. See the [Events module](../events/README.md#known-limitations--caveats).

### Example

```ts
import { PerformanceStats } from 'bf6-portal-utils/performance-stats';
import { Events } from 'bf6-portal-utils/events';
import { Timers } from 'bf6-portal-utils/timers';

// Optional: show spike warnings in UI or console
PerformanceStats.setLogging((text) => console.log(text), PerformanceStats.LogLevel.Warning);

Events.OnGameModeStarted.subscribe(() => {
    // Periodic UI update with smoothed metrics (stable for display)
    Timers.setInterval(() => {
        const hz = PerformanceStats.getSmoothedTickRate();
        const lagMs = PerformanceStats.getSmoothedTimeoutLagMs();
        updatePerformancePanel(hz, lagMs);
    }, 1_000);
});

// Scale expensive logic when the server is bogged down
Events.OngoingPlayer.subscribe((player: mod.Player) => {
    const health = PerformanceStats.getSpotHealthFactor();
    if (health < 0.8) {
        // Reduce check frequency or skip non-critical work
        return;
    }
    doExpensivePerPlayerWork(player);
});
```

---

## Module: player-locations

`PlayerLocations` is a high-performance, **Zero-Garbage-Collection (Zero-GC)** TypeScript spatial query engine built specifically for Battlefield 6 Portal experiences running an embedded QuickJS engine on a C++ server backend.

In Battlefield 6 Portal, querying player coordinates via engine Foreign Function Interface (FFI) calls (such as `mod.GetSoldierState`) in hot gameplay loops introduces noticeable C++ FFI overhead and garbage collection pressure. `PlayerLocations` eliminates this bottleneck by querying player positions once per tick at the start of the frame (`Events.OnTickStart`), transforming world coordinates into scaled integer representations inside cache-dense contiguous Typed Arrays, and providing a comprehensive suite of spatial, proximity, directional, and nearest-neighbor queries entirely within local JavaScript memory for all subsequent logic in the tick.

> **Note:** Since this module imports and relies on `Events`, **you must use the `Events` module as your only mechanism to subscribe to game events**—do not implement or export any Battlefield Portal event handler functions in your own code. See the [Events module](../events/README.md#known-limitations--caveats).

### Example

```ts
import { PlayerLocations } from 'bf6-portal-utils/player-locations';
import { Events } from 'bf6-portal-utils/events';

// Example: 2.5D Capture Zone Check (Radius: 15m, Y bounds: 10m to 30m)
const CAPTURE_ZONE = {
    x: 100.0,
    z: -250.0,
    radius: 15.0,
    minY: 10.0,
    maxY: 30.0,
};

// Initialize tracking once the server and match are ready
Events.OnGameModeStarted.subscribe(() => {
    PlayerLocations.initialize();
});

Events.OnTickStart.subscribe(() => {
    // Pure count query: zero memory allocations, zero array writes
    const playersInZoneCount = PlayerLocations.findPlayersInCylinder(
        CAPTURE_ZONE.x,
        CAPTURE_ZONE.z,
        CAPTURE_ZONE.radius,
        CAPTURE_ZONE.minY,
        CAPTURE_ZONE.maxY
    );

    if (playersInZoneCount > 0) {
        // Find closest active player to the center of the objective
        const closestId = PlayerLocations.getClosestPlayerId(CAPTURE_ZONE.x, 20.0, CAPTURE_ZONE.z);
        if (closestId !== undefined) {
            const player = PlayerLocations.getPlayer(closestId);
            // ... execute objective scoring or UI updates ...
        }
    }
});
```

### Pattern 1: Moving Payload / Dynamic Area Subscription

```ts
import { PlayerLocations } from 'bf6-portal-utils/player-locations';

// Track players entering/exiting a moving payload vehicle's aura
const payloadZoneHandle = PlayerLocations.onSphere(
    0,
    0,
    0,
    15.0,
    (player, playerId) => {
        console.log(`Player ${playerId} is now pushing the payload!`);
        // Grant ammo aura / buff
    },
    (player, playerId) => {
        console.log(`Player ${playerId} left payload aura.`);
        // Remove ammo aura / buff
    }
);

// On each payload movement step or waypoint progression:
export function onPayloadMoved(newX: number, newY: number, newZ: number, isStopped: boolean): void {
    // Dynamically shift coordinates and double radius when stopped (0 heap allocations)
    payloadZoneHandle.update(newX, newY, newZ, isStopped ? 30.0 : 15.0);
}

// When the match ends or payload is destroyed:
export function onRoundEnd(): void {
    payloadZoneHandle.unsubscribe();
}
```

### Pattern 2: High-Altitude Flight Ceiling Alert

```ts
import { PlayerLocations } from 'bf6-portal-utils/player-locations';

const FLIGHT_CEILING_Y = 800.0;

// Trigger warning when crossing above or returning below flight ceiling
const unsubCeiling = PlayerLocations.onCrossAltitude(
    FLIGHT_CEILING_Y,
    (pilot, playerId) => {
        // Play warning alarm sound or HUD warning
    },
    (pilot, playerId) => {
        // Clear HUD warning
    }
);
```

### Pattern 3: Dynamic VIP / King of the Hill Leader Tracking

```ts
import { PlayerLocations } from 'bf6-portal-utils/player-locations';

// Track when a new player takes the highest altitude lead
const unsubLeader = PlayerLocations.onHighestPlayerChanged((newHighest, prevHighest, newHighestId, prevHighestId) => {
    if (prevHighestId !== undefined) {
        console.log(`Player ${newHighestId} overtook player ${prevHighestId} for highest altitude!`);
    }
    // Update VIP scoreboard or 3D World Icon
});
```

### Pattern 4: Nearest Teammate Revive / Medic Aura

```ts
import { PlayerLocations } from 'bf6-portal-utils/player-locations';
import { Vectors } from 'bf6-portal-utils/vectors';

const scratchPos: Vectors.Vector3 = { x: 0, y: 0, z: 0 };

export function findNearestTeammate(medic: mod.Player): number | undefined {
    const medicPos = PlayerLocations.getPosition(medic, scratchPos);
    if (!medicPos) return undefined;

    const medicTeam = mod.GetPlayerTeam(medic);
    const medicId = PlayerLocations.getPlayerId(medic);

    // Filter predicate executes inside single linear pass with (candidatePlayer, candidateId)
    return PlayerLocations.getClosestPlayerId(medicPos.x, medicPos.y, medicPos.z, (candidatePlayer, candidateId) => {
        return mod.GetPlayerTeam(candidatePlayer) === medicTeam && candidateId !== medicId;
    });
}
```

### Pattern 5: Irregular Polygon Objective / Prismatic Capture Zone

```ts
import { PlayerLocations } from 'bf6-portal-utils/player-locations';

// Define a concave, irregular compound perimeter on the XZ ground plane
const COMPOUND_ZONE = [
    { x: 100.0, z: 100.0 },
    { x: 250.0, z: 120.0 },
    { x: 280.0, z: 200.0 },
    { x: 200.0, z: 260.0 },
    { x: 80.0, z: 180.0 },
];

// Subscribe to entry/exit transitions within the 2.5D polygon column (0m to 50m altitude)
const compoundHandle = PlayerLocations.onPrism(
    COMPOUND_ZONE,
    0.0,
    50.0,
    (player, playerId) => {
        console.log(`Player ${playerId} entered the compound capture zone.`);
        // Begin capture progress
    },
    (player, playerId) => {
        console.log(`Player ${playerId} exited the compound capture zone.`);
        // Halt capture progress
    }
);

// Query all active players inside the compound on demand
const defendersBuffer: number[] = [];
export function getDefendersInCompound(): number {
    return PlayerLocations.findPlayersInPrism(COMPOUND_ZONE, 0.0, 50.0, undefined, defendersBuffer) ?? 0;
}
```

### Pattern 6: High-Altitude Airstrike Warning

```ts
import { PlayerLocations } from 'bf6-portal-utils/player-locations';

const pilotsBuffer: mod.Player[] = [];

export function warnHighAltitudePilots(minAltitudeMeters: number): void {
    // Instantly queries Y-axis sorted bounds and populates pilot objects
    const count = PlayerLocations.findPlayersAbove(minAltitudeMeters, undefined, undefined, pilotsBuffer);

    for (let i = 0; i < count; ++i) {
        const pilot = pilotsBuffer[i];
        // Display SAM lock warning UI or sound
    }
}
```

---

## Module: player-undeploy-fixer

The `PlayerUndeployFixer` namespace is a small helper that automatically subscribes to `OnPlayerDied`, `OnPlayerUndeploy`, and `OnPlayerLeaveGame` via the `Events` module. It tracks whether a player who died has properly undeployed within a fixed time window (currently 30 seconds). If not—e.g. the player is stuck in a "limbo" state where the engine did not fire `OnPlayerUndeploy`—the fixer manually triggers `Events.OnPlayerUndeploy.trigger(player)` so that any code subscribed to `OnPlayerUndeploy` runs correctly. This fix is mainly useful in handling static AI bots that do not properly undeploy when they die, which, when left unchecked, results in a slowly growing population of stuck AI that never redeploy.

No setup is required beyond importing the module; subscribing and triggering are handled internally.

> **Note:** Since this module imports and relies on `Events`, **you must use the `Events` module as your only mechanism to subscribe to game events**—do not implement or export any Battlefield Portal event handler functions in your own code. See the [Events module](../events/README.md#known-limitations--caveats).

### Example

```ts
import { PlayerUndeployFixer } from 'bf6-portal-utils/player-undeploy-fixer';

// Optional: log when the fixer forces an undeploy
PlayerUndeployFixer.setLogging((text) => console.log(text), PlayerUndeployFixer.LogLevel.Warning);
```

## Known Limitations & Caveats

- **Events module required** – Since this module uses the `Events` module, you **must** use the [Events module](../events/README.md) for all game event subscription and **must not** implement or export any Battlefield Portal event handler functions. See [Events — Known Limitations & Caveats](../events/README.md#known-limitations--caveats).
- **Fixed delay** – The time window before forcing an undeploy is currently a fixed 30 seconds and is not configurable via the public API.
- **Trigger semantics** – When the fixer calls `Events.OnPlayerUndeploy.trigger(player)`, all subscribers to `OnPlayerUndeploy` are invoked. Ensure your subscriber can safely run when the player is in the "stuck" state (e.g. not assuming the player is on the deploy screen in the usual way).

---

## Module: portal-gadget

This TypeScript `PortalGadget` namespace provides a high-level API for Battlefield 6 Portal's Portal Gadget laser behavior. It captures player state at fire start/stop so your handlers get a stable snapshot (`isZooming` plus a lazy `getTarget()` function), and it abstracts the undocumented laser origin/angle offsets for both zoomed and hip-fired states.

The module also exposes `PortalGadget.getLaserTarget(player)` so you can query the current laser target on demand, independent of fire events. Internally, laser targeting uses the `Raycast` module and handles asynchronous hit/miss routing for you.

> **Note:** Since this module imports and relies on `Events`, **you must use the `Events` module as your only mechanism to subscribe to game events**—do not implement or export any Battlefield Portal event handler functions in your own code. See the [Events module](../events/README.md#known-limitations--caveats).

### Example

```ts
import { PortalGadget } from 'bf6-portal-utils/portal-gadget';
import { Events } from 'bf6-portal-utils/events';

PortalGadget.setLogging((text) => console.log(text), PortalGadget.LogLevel.Warning);

const unsubscribeFireStart = PortalGadget.onFireStart(async (player, isZooming, getTarget) => {
    const target = await getTarget();

    if (!target) return;

    console.log(
        `Portal Gadget laser started ${isZooming ? 'zoom-firing' : 'hip-firing'} at: ${mod.XComponentOf(target)}, ${mod.YComponentOf(target)}, ${mod.ZComponentOf(target)}`
    );
});

const unsubscribeFireStop = PortalGadget.onFireStop(async (player, isZooming, getTarget) => {
    const target = await getTarget();

    if (!target) return;

    console.log(
        `Portal Gadget laser stopped ${isZooming ? 'zoom-firing' : 'hip-firing'} at: ${mod.XComponentOf(target)}, ${mod.YComponentOf(target)}, ${mod.ZComponentOf(target)}`
    );
});

Events.OnGameModeEnded.subscribe(() => {
    unsubscribeFireStart();
    unsubscribeFireStop();
});
```

### Example: On-Demand Laser Query

```ts
import { PortalGadget } from 'bf6-portal-utils/portal-gadget';
import { Timers } from 'bf6-portal-utils/timers';
import type { Vectors } from 'bf6-portal-utils/vectors';

const unsubscribe = PortalGadget.onFireStart(async (player, isZooming, getTarget) => {
    unsubscribe(); // Immediately unsubscribe, so the event is a "once".

    const points: Vectors.Vector3[] = [];

    // Capture points at 500ms intervals until we have 10 valid points, then draw them.
    const timer = Timers.setInterval(async () => {
        const target = await PortalGadget.getLaserTarget(player);

        if (!target) return;

        points.push(target);

        if (points.length >= 10) {
            Timers.clearInterval(timer);
            drawPoints(points); // Example function that can draw the points with WorldIcons.
        }
    }, 500);
});
```

---

## Module: quaternions

The `Quaternions` namespace provides a high-performance, zero-allocation 4D Hamiltonian quaternion mathematics library for Battlefield 6 Portal. Quaternions represent 3D orientations and rotations without the gimbal lock, interpolation anomalies, or computational overhead associated with Euler angles and 3x3 rotation matrices.

Key features include:

- **Transparent Quaternion Type** – Plain `{ w: number, x: number, y: number, z: number }` structures where `w` is the real scalar component.
- **Zero-Allocation `out` Parameters** – Every transformative operation accepts an optional `out?: Quaternion` destination to eliminate heap allocations and GC spikes in active 60 Hz game loops.
- **Euler (ZYX Order) Conversions** – Pristine conversions to and from Euler pitch, yaw, and roll in radians matching Frostbite/Godot coordinate conventions.
- **Arbitrary-Axis Rotations** – Fast construction from any 3D unit axis and angle via `fromAxisAngle()`.
- **Vector Rotation** – Rotate any `Vectors.Vector3` in 3D space with zero intermediate heap allocations.
- **Spherical Linear Interpolation (SLERP)** – Constant-speed smooth rotational interpolation between orientations.
- **Compound Multiplication & Inversion** – Hamiltonian product (`multiply`) and quaternion conjugation (`conjugate`).

### 1. Rotating a 3D Offset Around an Arbitrary Axis

```ts
import { Quaternions } from 'bf6-portal-utils/quaternions';
import { Vectors } from 'bf6-portal-utils/vectors';

// Pre-allocate scratch instances for zero-allocation reuse
const rot: Quaternions.Quaternion = { w: 1, x: 0, y: 0, z: 0 };
const offset: Vectors.Vector3 = { x: 5, y: 0, z: 0 };
const rotatedOffset: Vectors.Vector3 = { x: 0, y: 0, z: 0 };

// Rotate 90 degrees around the Y (up) axis into pre-allocated rot
Quaternions.fromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2, rot);
Quaternions.rotateVector(offset, rot, rotatedOffset);

// rotatedOffset is now (0, 0, -5)
```

---

### 2. Smooth Orientation Interpolation (SLERP)

```ts
import { Quaternions } from 'bf6-portal-utils/quaternions';

const currentRot: Quaternions.Quaternion = { w: 1, x: 0, y: 0, z: 0 };
const targetRot = Quaternions.fromEuler(0, Math.PI, 0); // 180-degree yaw
const smoothedRot: Quaternions.Quaternion = { w: 1, x: 0, y: 0, z: 0 };

export function OnTick(deltaTime: number) {
    const slerpSpeed = 5.0;
    const t = Math.min(1.0, slerpSpeed * deltaTime);

    // Smoothly step orientation towards targetRot
    Quaternions.slerp(currentRot, targetRot, t, smoothedRot);
    Quaternions.copy(currentRot, smoothedRot);
}
```

---

## Module: raycast

This TypeScript `Raycast` namespace provides high-throughput, zero-allocation asynchronous raycasting for Battlefield Portal experiences. It manages engine constraints by automatically queueing requests and dispatching them across all available worker slots each tick (1 ray per connected player + 1 player-less global ray per tick), providing deterministic $O(1)$ hit and miss attribution.

The namespace subscribes to `Events.OnTickStart` (to dispatch raycast requests at the beginning of each frame), `Events.OnRayCastHit`, `Events.OnRayCastMissed`, `Events.OnPlayerJoinGame`, and `Events.OnPlayerLeaveGame` at load time—no manual event wiring is required. You simply pass start/end coordinates and callbacks (`onHit`, `onMiss`) to `Raycast.cast()`.

> **Note:** Since this module imports and relies on `Events`, **you must use the `Events` module as your only mechanism to subscribe to game events**—do not implement or export any Battlefield Portal event handler functions in your own code. See the [Events module](../events/README.md#known-limitations--caveats).

### Example

```ts
import { Raycast } from 'bf6-portal-utils/raycast';
import { Events } from 'bf6-portal-utils/events';

// Optional: Configure logging for raycast callback error monitoring
Raycast.setLogging((text) => console.log(text), Raycast.LogLevel.Error);

Events.OnPlayerDeployed.subscribe((player: mod.Player) => {
    const playerPosition = mod.GetObjectPosition(player);
    const forwardDirection = mod.GetSoldierState(player, mod.SoldierStateVector.GetDirection);
    const rayEnd = mod.VectorAdd(playerPosition, mod.VectorScale(forwardDirection, 100));

    // Cast a ray from the player's position forward to detect obstacles
    Raycast.cast(
        {
            x: mod.XComponentOf(playerPosition),
            y: mod.YComponentOf(playerPosition),
            z: mod.ZComponentOf(playerPosition),
        },
        {
            x: mod.XComponentOf(rayEnd),
            y: mod.YComponentOf(rayEnd),
            z: mod.ZComponentOf(rayEnd),
        },
        (hit, hitPoint, normal) => {
            if (hit && hitPoint && normal) {
                console.log(`Ray hit at <${hitPoint.x}, ${hitPoint.y}, ${hitPoint.z}>`);
                console.log(`Surface normal: <${normal.x}, ${normal.y}, ${normal.z}>`);
            } else {
                console.log('Ray missed - no obstacle detected');
            }
        },
        { priority: Raycast.Priority.Standard, maxAgeTicks: 5 }
    );
});
```

---

## Module: scavenger-drop

The `ScavengerDrop` namespace provides functionality for Battlefield Portal experiences to detect when a player scavenges a dead player's kit bag. In Battlefield 6, when a player dies, they drop a bag containing their kit that despawns after approximately 37 seconds. Players can pick up weapons from these bags, but the default behavior does not replenish the scavenging player's ammo. This module allows you to perform custom actions (such as resupplying ammo, displaying messages, or any other logic) when the first player gets within 2 meters of a dead player's body.

**Why use ScavengerDrop?** The `ScavengerDrop` module offers significant advantages: automatic detection of players scavenging dead bodies powered by zero-GC reactive spatial tracking (`PlayerLocations.onSphere`), support for custom callbacks to handle scavenging events, and automatic cleanup when drops expire or are scavenged. Ideal for ammo resupply systems, custom loot mechanics, achievement tracking, or any scenario where you need to detect and respond to players picking up dropped kits.

Key features include zero-polling reactive proximity detection using 2-meter sphere zone subscriptions (`PlayerLocations.onSphere`), automatic expiration processing evaluated at the start of each tick (`Events.OnTickStart`) after the configured duration (defaulting to 37 seconds to match the game's bag despawn time), graceful error handling that prevents callback failures from crashing your mod, and configurable logging for debugging scavenger drop behavior. The module runs on flat typed arrays (Struct-of-Arrays) with an intrusive `Int8Array` free-list for zero runtime heap allocations.

> **Note:** Since this module imports and relies on `Events`, **you must use the `Events` module as your only mechanism to subscribe to game events**—do not implement or export any Battlefield Portal event handler functions in your own code. See the [Events module](../events/README.md#known-limitations--caveats).

### Example

```ts
import { ScavengerDrop } from 'bf6-portal-utils/scavenger-drop';

// Optional: Configure logging for scavenger drop monitoring
ScavengerDrop.setLogging((text) => console.log(text), ScavengerDrop.LogLevel.Info);

export function OnPlayerDied(
    victim: mod.Player,
    killer: mod.Player,
    deathType: mod.DeathType,
    weapon: mod.WeaponUnlock
): void {
    // Create a scavenger drop that triggers when a player gets within 2 meters
    // Callbacks can be synchronous or asynchronous (return void or Promise<void>)
    ScavengerDrop.create(victim, (scavenger: mod.Player) => {
        // Resupply the scavenger's primary weapon magazine ammo
        mod.SetInventoryMagazineAmmo(
            scavenger,
            mod.InventorySlots.PrimaryWeapon,
            mod.GetInventoryMagazineAmmo(scavenger, mod.InventorySlots.PrimaryWeapon) + 30
        );

        // Display a message to the scavenger
        mod.DisplayHighlightedWorldLogMessage(mod.Message(mod.stringkeys.scavengerLog), scavenger); // 'Scavenged ammo'
    });
}
```

## Usage Patterns

- **Basic ammo resupply** – Use `mod.Resupply()` in the callback to give players full ammo when they scavenge a kit.
- **Custom ammo management** – Use `mod.SetInventoryAmmo()` and `mod.SetInventoryMagazineAmmo()` for fine-grained ammo control.
- **Player notifications** – Use `mod.DisplayHighlightedWorldLogMessage()` to inform players when they scavenge a kit.
- **Kill Confirmed** – Spawn an item on the dead body and give points to the player or team that confirms the kill.
- **Achievement tracking** – Track scavenging events for statistics or achievements.
- **Custom loot systems** – Implement custom loot mechanics beyond the default kit bag behavior.
- **Drop cleanup** – Use `stop(id)` or `stopAll()` to manually cancel drops when needed (e.g., round end or game mode resets).

### Example: Custom Duration and Async Callback Handling

```ts
import { ScavengerDrop } from 'bf6-portal-utils/scavenger-drop';

export function OnPlayerDied(
    victim: mod.Player,
    killer: mod.Player,
    deathType: mod.DeathType,
    weapon: mod.WeaponUnlock
): void {
    // Create a drop that lasts 20 seconds
    ScavengerDrop.create(
        victim,
        async (scavenger: mod.Player) => {
            // Perform async operations
            await someAsyncOperation();

            mod.Resupply(scavenger, mod.ResupplyTypes.AmmoBox);

            // Log to external service, update statistics, etc.
            await logScavengeEvent(scavenger, victim);
        },
        20_000 // 20 seconds duration
    );
}
```

## Known Limitations & Caveats

- **Pool Capacity** – The drop pool is pre-allocated to 128 concurrent slots (`MAX_DROPS`). If the pool is full when calling `create()`, it logs an error via `Logging` and returns `null` without throwing an exception.
- **Position Capture** – The drop captures the position of the dead player's body at creation time. If the body moves (e.g., due to physics or explosions), the drop will continue monitoring the original position. Always create the drop immediately in `OnPlayerDied` to ensure the position is accurate.
- **Single Trigger** – Each drop triggers its callback only once—when the first player gets within 2 meters. If multiple players enter simultaneously, only the first triggering player receives the callback.
- **Distance Precision** – The 2-meter threshold is fixed and matches typical interaction ranges in Battlefield Portal.
- **Async Callbacks** – Callbacks can be synchronous or asynchronous (returning `void` or `Promise<void>`). Async callbacks are not awaited by the drop; errors or rejections are caught and logged via `CallbackHandler`.

---

## Module: adapters

The `SolidTweenAdapter`, `SolidSpringAdapter`, and `SolidDecayAdapter` namespaces provide reactive animation adapters bridging `Animations` and `Transitions` with Structure of Arrays Solid reactivity (`createSignal`, `createEffect`, `onCleanup`).

Key features include:

- **`SolidTweenAdapter.createTween(target, options)`** – Creates a reactive accessor that smoothly interpolates to new target values as the input signal changes.
- **`SolidSpringAdapter.createSpring(target, options)`** – Creates a reactive spring physics accessor that tracks dynamic target values with momentum and velocity continuity.
- **`SolidDecayAdapter.createDecay(velocity, options)`** – Creates a reactive friction-based decay/inertia accessor that glides position from current value based on velocity impulses.
- **Automatic Lifecycle Cleanup** – Registers `onCleanup()` on the active component scope to immediately cancel running animations when components unmount or target values retarget mid-flight.

### Examples

```ts
import { Solid } from 'bf6-portal-utils/solid/index.ts';
import { SolidTweenAdapter } from 'bf6-portal-utils/solid/adapters/createTween.ts';
import { SolidSpringAdapter } from 'bf6-portal-utils/solid/adapters/createSpring.ts';
import { SolidDecayAdapter } from 'bf6-portal-utils/solid/adapters/createDecay.ts';

// 1. SoA reactive tween
const [width, setWidth] = Solid.createSignal(100);
const animatedWidth = SolidTweenAdapter.createTween(width, { duration: 400 });

// 2. SoA spring physics
const [positionX, setPositionX] = Solid.createSignal(0);
const animatedX = SolidSpringAdapter.createSpring(positionX, { stiffness: 180, damping: 24 });

// 3. SoA decay / inertia momentum
const [scrollVelocity, setScrollVelocity] = Solid.createSignal(0);
const scrollOffset = SolidDecayAdapter.createDecay(scrollVelocity, { from: 0, deceleration: 0.997 });
```

---

## Module: solid

This TypeScript `Solid` namespace provides an ultra-low-overhead, pure **Structure-of-Arrays (SoA)** reactive UI and object framework for Battlefield Portal, inspired by [SolidJS](https://github.com/solidjs/solid). Unlike traditional frameworks that re-render entire components, `Solid` uses fine-grained reactivity to update only the specific properties that change, resulting in minimal overhead and maximum performance.

`Solid` is a from-scratch implementation of reactive primitives (signals, effects, memos, stores) adapted for the resource-constrained Battlefield 6 Portal embedded JavaScript environment (QuickJS). It uses a HyperScript factory function (`Solid.h()`) instead of JSX/TSX, and integrates seamlessly with both the 2D [`UI`](../ui/README.md) module and the 3D [`Spatial`](../spatial/README.md) scene graph to create dynamic, reactive user interfaces and scene hierarchies.

Unlike traditional reactive engines that allocate JavaScript closures, wrapper tuples, and class instances (`new Subscriber()`, `new SignalState()`), `Solid` operates on generation-encoded, branded integer identifiers (`SignalID`, `EffectID`) backed entirely by flat TypedArrays, static 2D dependency buffers (`MAX_DEPS_PER_SUB = 8`), and an intrusive doubly-linked edge graph.

Updates are driven by a logical tick counter (advanced on each `Events.OnTickEnd` callback at priority `-95`), a two-tier scheduler queue (flat array for immediate microtasks and flat array for deferred ticks), and the microtask queue for immediate (`deferTicks: 0`) work. Optional **`deferTicks`** on effects, memos, `h()` bindings, and `Index()` coalesces re-runs to a future logical tick. Subscribing to `OnTickEnd` (`-95`) ensures that any reactive state written during `OnTickStart` or mid-tick engine events evaluates _before_ `Animations` (`-90`), `Spatial` (`-80`), and `UI.flush()` (`100`), allowing reactive updates to drive animations and scene graph transforms and commit to the UI in the exact same frame. The module uses the `Logging` module for internal logging, including scheduler safety limits (`MAX_EXECUTIONS_PER_FLUSH`, `MAX_FLUSHES_PER_TICK`).

> **Note** The `Solid` namespace is decoupled from the `UI` and `Spatial` modules but has been designed and tested with them. It assumes that UI/Spatial objects have getters and setters for properties that need to be reactive.

> **Note:** Since this module imports and relies on `Events`, **you must use the `Events` module as your only mechanism to subscribe to game events**—do not implement or export any Battlefield Portal event handler functions in your own code. See the [Events module](../events/README.md#known-limitations--caveats).

### Example

**File: `src/index.ts`**

```ts
import { Solid } from 'bf6-portal-utils/solid';
import { UI } from 'bf6-portal-utils/ui';

// Optional: Configure logging for reactive system error monitoring
Solid.setLogging((text) => console.log(text), Solid.LogLevel.Error);

function createCounterUI(player: mod.Player): void {
    // Create a reactive signal (returns a branded SignalID integer handle)
    const countSig = Solid.createSignal(0);

    // Create a container with reactive visibility
    const container = Solid.h(UI.Container, {
        receiver: player,
        width: 200,
        height: 300,
        visible: true,
    });

    // Create text that updates when count changes (using a getter function)
    Solid.h(UI.Text, {
        parent: container,
        anchor: UI.Anchor.TopCenter,
        width: 200,
        message: () => mod.Message(mod.stringkeys.count, Solid.read(countSig)),
        textSize: 30,
        textColor: UI.COLORS.BLACK,
    });

    // Create text that coalesces count change updates every 30 ticks
    Solid.h(
        UI.Text,
        {
            parent: container,
            anchor: UI.Anchor.Center,
            width: 200,
            message: () => mod.Message(mod.stringkeys.count, Solid.read(countSig)),
            textSize: 30,
            textColor: UI.COLORS.BLACK,
        },
        { deferTicks: 30 } // Coalesce updates every 30 ticks
    );

    // Create a button that increments the count
    Solid.h(UI.TextButton, {
        parent: container,
        anchor: UI.Anchor.BottomCenter,
        width: 200,
        message: mod.Message(mod.stringkeys.increment),
        textSize: 30,
        textColor: UI.COLORS.BLACK,
        onClick: async () => {
            // Update signal with a function receiving the previous value
            Solid.write(countSig, (c) => c + 1);
            // Solid.write(countSig, Solid.read(countSig) + 1); // Alternative: direct value write
        },
    });
}
```

**File: `src/strings.json`**

```json
{
    "count": "Count: {}",
    "increment": "Increment"
}
```

```ts
const countSig = Solid.createSignal(0);

// Read the value (subscribes if called inside an effect or reactive property)
console.log(Solid.read(countSig)); // 0

// Update with a value
Solid.write(countSig, 5);

// Update with a function (receives previous value)
Solid.write(countSig, (prev) => prev + 1);
```

```ts
const countSig = Solid.createSignal(0);

// Effect runs immediately and whenever countSig changes
const effectId = Solid.createEffect(() => {
    console.log(`Count is now: ${Solid.read(countSig)}`);
});

// Optional: defer re-runs by 2 logical ticks (coalesces rapid writes)
// const deferredId = Solid.createEffect(() => { ... }, { deferTicks: 2 });

Solid.write(countSig, 5); // Logs: "Count is now: 5"
Solid.write(countSig, 10); // Logs: "Count is now: 10"

// Stop and destroy the effect
Solid.destroyEffect(effectId);
```

```ts
const firstName = Solid.createSignal('John');
const lastName = Solid.createSignal('Doe');

// Create a memoized full name
const fullName = Solid.createMemo(() => `${Solid.read(firstName)} ${Solid.read(lastName)}`);

console.log(Solid.read(fullName)); // "John Doe"

Solid.write(firstName, 'Jane');
console.log(Solid.read(fullName)); // "Jane Doe" (automatically recomputed)
```

```ts
const [state, setState] = Solid.createStore({
    user: {
        name: 'John',
        age: 30,
    },
    settings: {
        theme: 'dark',
    },
});

// Read values (automatically tracks which properties you access)
console.log(state.user.name); // "John"

// Update values using the setter
setState((s) => {
    s.user.name = 'Jane'; // Only effects reading user.name will run
});

// Update nested properties
setState((s) => {
    s.settings.theme = 'light'; // Only effects reading settings.theme will run
});
```

```ts
// Create a theme context
const ThemeContext = Solid.createContext<'light' | 'dark'>('light');

// Provide a theme value
ThemeContext.provide('dark', () => {
    // All useContext(ThemeContext) calls inside this scope return 'dark'
    const container = Solid.h(UI.Container, {
        bgColor: () => {
            const theme = Solid.useContext(ThemeContext);
            return theme === 'dark' ? UI.COLORS.BLACK : UI.COLORS.WHITE;
        },
    });
});

// Use the context outside
const theme = Solid.useContext(ThemeContext); // Returns 'light' (default)
```

```ts
const countSig = Solid.createSignal(0);
const timerSig = Solid.createSignal(0);

Solid.createEffect(() => {
    console.log(Solid.read(countSig)); // Tracks 'countSig'
    Solid.untrack(() => {
        console.log(Solid.read(timerSig)); // Logs 'timerSig' but doesn't track it
    });
});
```

```ts
const countSig = Solid.createSignal(0);
const visibleSig = Solid.createSignal(true);

// 1. Direct SignalID prop binding
const container = Solid.h(UI.Container, {
    visible: visibleSig, // Passes SignalID directly
    width: 200,
    height: 100,
});

// 2. Getter function binding
Solid.h(UI.Text, {
    parent: container,
    message: () => mod.Message(mod.stringkeys.count, Solid.read(countSig)),
    textSize: 30,
});
```

```ts
const itemsSig = Solid.createSignal([
    { id: 1, name: mod.Message(mod.stringkeys.team1) },
    { id: 2, name: mod.Message(mod.stringkeys.team2) },
]);

const container = Solid.h(UI.Container, { width: 300, height: 400 });

Solid.Index(itemsSig, (itemSig, index) => {
    return Solid.h(UI.Text, {
        parent: container,
        y: index * 50,
        message: () => Solid.read(itemSig).name, // Per-row reactive signal
        textSize: 24,
    });
});
```

---

## Module: sounds

This TypeScript `Sounds` namespace wraps Battlefield Portal’s SFX workflow into a pure functional decorator API around native `mod.SFX` spatial objects. It creates spatial sounds, routes playback to specific audiences (players, squads, or teams), handles stepped volume fading, timed stops, and automatic cleanup. The module builds on the [`Timers`](../timers/README.md) module for delays/fades and uses the [`Logging`](../logging/README.md) module for optional diagnostics.

Use **`Sounds.create()`** to spawn a native `mod.SFX` object, or pass any existing `mod.SFX` (from map fixtures or other modules) into **`Sounds.play()`**, **`Sounds.stop()`**, **`Sounds.fade()`**, and **`Sounds.dispose()`**. For fire-and-forget one-shots, call **`Sounds.playOneShot()`** which creates, plays, and automatically unspawns the sound upon duration expiry.

> **Resource Management.** Sounds created with `Sounds.create()` or `mod.SpawnObject()` remain active on the server until **`Sounds.dispose(sfx)`** or **`mod.UnspawnObject(sfx)`** is called. Fire-and-forget sounds created via **`Sounds.playOneShot()`** are automatically disposed upon duration expiry. Always dispose long-lived sounds when their lifecycle ends (e.g. game phase transition or player leave).

> **Note:** Since this module imports and relies on `Events`, **you must use the `Events` module as your only mechanism to subscribe to game events**—do not implement or export any Battlefield Portal event handler functions in your own code. See the [Events module](../events/README.md#known-limitations--caveats).

### Example: fire-and-forget one-shot

```ts
import { Sounds } from 'bf6-portal-utils/sounds';

// Plays a 3D explosion sound for 3 seconds, then automatically unspawns/disposes it:
Sounds.playOneShot(mod.RuntimeSpawn_Common.SFX_Explosions_Large_OneShot3D, 3_000, 1.0, {
    position: mod.CreateVector(100, 20, -50),
    attenuationRange: 50,
});
```

### Example: one-shot with automatic fade

```ts
import { Sounds } from 'bf6-portal-utils/sounds';

// Plays a 2D sound for 5 seconds that automatically begins fading out after 2 seconds:
Sounds.playOneShot(mod.RuntimeSpawn_Common.SFX_UI_EOR_Counting_SimpleLoop2D, 5_000, 0.8, {
    fadeOptions: {
        delay: 2_000,
        duration: 3_000,
        targetAmplitude: 0,
        stopOnComplete: true,
    },
});
```

### Example: persistent spatial sound manipulation

```ts
import { Sounds } from 'bf6-portal-utils/sounds';

// 1. Create native mod.SFX spatial object:
const alarmSFX = Sounds.create(
    mod.RuntimeSpawn_Common.SFX_GameModes_Rush_Alarm_SimpleLoop3D,
    mod.CreateVector(0, 5, 0)
);

// 2. Play it with an initial attenuation range:
Sounds.play(alarmSFX, 1.0, { attenuationRange: 30 });

// 3. Move the spatial object natively or via a spatial physics library:
mod.MoveObjectOverTime(alarmSFX, mod.CreateVector(20, 5, 0), mod.CreateVector(0, 0, 0), 5, false, false);

// 4. Smoothly fade it out:
Sounds.fade(alarmSFX, {
    startAmplitude: 1.0,
    targetAmplitude: 0,
    duration: 3_000,
    stopOnComplete: true,
});

// 5. Clean up when no longer needed:
// Sounds.dispose(alarmSFX);
```

---

## Module: spatial

The `Spatial` namespace provides a high-performance, unified 3D scene graph and hierarchical transformation system for Battlefield 6 Portal.

It combines an **ergonomic, object-oriented class API** (`new Spatial.Empty()`, `new Spatial.Runtime()`, `new Spatial.Existing()`) with a **high-performance Structure of Arrays (SoA) backend** stored in flat TypedArrays (`Float32Array`, `Int16Array`, `Uint8Array`).

This architecture:

- Provides **100% native compatibility with [`Solid.h()`](../solid/README.md)** for declarative, fine-grained reactive 3D hierarchies.
- Uses **zero-allocation property setters** that write directly to contiguous flat buffers and set bitflags (`FLAG_DIRTY | FLAG_ENGINE_TRANSFORM_DIRTY`).
- Features complete **1:1 API symmetry** between OOP instance methods and raw integer ID functions (`Spatial.createRuntimeId()`, `Spatial.setLocalPosition()`) for high-throughput, zero-heap particle and projectile swarms.
- Prevents stale ID reuse with **generation-encoded IDs** (`SpatialNodeID`) with slot retirement at 65,535 generations to eliminate wrap-around collisions.
- Incorporates **deadband synchronization**: only issues native `mod.SetObjectTransform` calls when cumulative evaluated world transforms exceed configurable thresholds (`positionRenderPrecision`, `rotationRenderPrecision`), dramatically cutting Portal engine overhead.
- Supports **hierarchical scale propagation**: parent scale scales child spatial translation offsets and orbital distances in world space (`worldPos = parentPos + parentRot * (childPos * parentScale)`). _Note_: dynamic runtime scale modifications update hierarchical coordinates and space projections, but do not alter the visual draw mesh scale of already-spawned native engine objects (which is fixed at spawn by the engine via `spawnScale`).

> **Note:** Since this module imports and relies on `Events`, **you must use the `Events` module as your only mechanism to subscribe to game events**—do not implement or export any Battlefield Portal event handler functions in your own code. See the [Events module](../events/README.md#known-limitations--caveats).

## Declarative 3D with `Solid`

Because `Spatial.Empty`, `Spatial.Runtime`, and `Spatial.Existing` expose public constructors and standard property getters and setters, they integrate seamlessly with `Solid.h()`:

```ts
import { Events } from 'bf6-portal-utils/events';
import { Quaternions } from 'bf6-portal-utils/quaternions';
import { Solid } from 'bf6-portal-utils/solid';
import { Spatial } from 'bf6-portal-utils/spatial';
import { Vectors } from 'bf6-portal-utils/vectors';

// Note: This is just an example of combining Spatial and Solid to create a controller camera. In practice, the Spatial API provides simpler follow controls to replicate this in fewer lines.
export function createControlledCameraWithSolid(player: mod.Player) {
    // 1. Reactive state signal for camera rotation (returns a SignalID handle)
    const aimSignal = Solid.createSignal<Quaternions.Quaternion>({ w: 1, x: 0, y: 0, z: 0 });

    // 2. Base anchor attached to player object position
    const cameraBase = Solid.h(Spatial.Empty, {
        position: () => mod.GetObjectPosition(player),
    });

    // 3. Aiming camera with fine-grained reactive rotation
    const camera = Solid.h(Spatial.Runtime, {
        parent: cameraBase,
        prefab: mod.RuntimeSpawn_Common.CameraSurveillance_01_B,
        position: { x: 0, y: 1.5, z: 0 }, // Above the player's head
        localRotation: aimSignal, // Automatically creates effect + setter binding
    });

    // 4. Update yaw-only rotation from player facing direction each tick
    Events.OnTickStart.subscribe(() => {
        // Retrieve 3D rotation vector from player object
        const rotation = Vectors.toVector3(mod.GetObjectRotation(player));

        Solid.write(aimSignal, Quaternions.fromPlayerRotation(rotation));
    });

    return { cameraBase, camera, aimSignal };
}

// Note: Simpler follower
export function createControlledCameraWithFollow(player: mod.Player): Spatial.Runtime {
    const camera = new Spatial.Runtime({
        prefab: mod.RuntimeSpawn_Common.CameraSurveillance_01_B,
    });

    camera.setFollow({
        target: player,
        offset: { x: 0, y: 1.5, z: 0 }, // Above the player's head
        trackRotation: true,
    });

    return camera;
}
```

---

## High-Throughput Raw ID Bypass (Zero Heap Allocations)

For large systems (e.g. 100+ projectiles, particles, or debris chunks), bypass class wrapper allocations entirely using raw integer IDs (`SpatialNodeID`):

```ts
import { Spatial } from 'bf6-portal-utils/spatial';

// Pre-allocate ID buffer
const projectileIds = new Int16Array(100);

for (let i = 0; i < 100; ++i) {
    // 0 heap objects allocated
    const id = Spatial.createRuntimeId({
        prefab: mod.RuntimeSpawn_Common.Sphere_01,
        position: { x: i * 2, y: 0, z: 0 },
    });

    if (id !== null) {
        projectileIds[i] = id;
    }
}

// In tick loop (0 allocations):
for (let i = 0; i < 100; ++i) {
    const id = projectileIds[i] as Spatial.SpatialNodeID;
    Spatial.setLocalPosition(id, { x: i * 2, y: Math.sin(Date.now() / 100 + i), z: 0 });
}
```

---

## Module: timelines

The `Timelines` namespace provides a high-performance, target-agnostic animation choreography engine tailored for server-side QuickJS environments in Battlefield Portal. The system enables multi-step sequencing—including sequential and parallel tweens, spring physics, delays, loops, and action/event callbacks—with zero steady-state heap allocations, Structure-of-Arrays (SoA) pooling, dual-duty intrusive free-lists, and centralized master ticker integration.

Key features include:

- **Structure of Arrays Engine (`Timelines`)** – Pooled state management using TypedArrays (`Uint8Array`, `Uint16Array`, `Uint32Array`, `Int16Array`) with a dual-duty free-list array (`_currentStep`) to eliminate GC pressure during playback.
- **Dual API Access** – Exposes both a pure, unboxed primitive `TimelineID` functional API (`Timelines.play(id)`, `Timelines.stop(id)`) for zero-allocation game loops, and an optional, thin object-oriented wrapper (`new Timelines.Timeline()`).
- **Flexible Step Choreography** – Supports single tweens (`addTween`), spring physics (`addSpring`), friction-based decay (`addDecay`), parallel multi-track batches (`addParallel`), delays (`addWait`), and action/event triggers (`addCall`).
- **Start Delays & Cascade Staggering (`delayMs`)** – Native start delay support on all animation steps and parallel child tracks for clean staggered cascade reveals.
- **Update Rate Throttling (`minUpdateDeltaMs`)** – Configurable default throttle rate per timeline with step-level overrides to minimize server tick processing overhead.
- **Looping & Yoyo Alternation** – Supports finite or infinite looping (`loop: true | number`) with optional ping-pong reverse alternation (`yoyo: true`) and `onStep`, `onLoop`, and `onComplete` lifecycle callbacks.
- **Sync & Async Callback Safety** – Callbacks (`onStep`, `onLoop`, `onComplete`, `addCall`, and step `onUpdate`/`onComplete`) accept both synchronous `void` and asynchronous `Promise<void>` functions with integrated rejection catching via `CallbackHandler`.
- **Target Agnostic & Strict Encapsulation** – Does not directly mutate engine objects. Operates on progress values ($0 \to 1$) and numbers, allowing seamless choreography across `UI`, `Spatial`, audio, and custom gameplay state.
- **Tick Lifecycle Integration (`OnTickEnd` at Priority `-100` / `First`)** – Subscribes to `Events.OnTickEnd` before all other simulation modules so that step transitions and newly triggered child tweens are registered immediately before `Solid` (`-95`), `Animations` (`-90`), `Spatial` (`-80`), and `UI.flush()` (`100`) execute in the same frame.

> **Note:** Since this module imports and relies on `Events`, **you must use the `Events` module as your only mechanism to subscribe to game events**—do not implement or export any Battlefield Portal event handler functions in your own code. See the [Events module](../events/README.md#known-limitations--caveats).

### Examples

#### 1. Functional ID-Based Timeline (Zero Heap Allocations)

```ts
import { Timelines } from 'bf6-portal-utils/timelines';
import { Transitions } from 'bf6-portal-utils/transitions';
import { Vectors } from 'bf6-portal-utils/vectors';

const scratch = { x: 0, y: 0, z: 0 };
const startPos = { x: -500, y: 0, z: 0 };
const endPos = { x: 0, y: 0, z: 0 };

// Allocate timeline
const id = Timelines.create({
    onComplete: () => {
        // Timeline completed
    },
});

if (id !== null) {
    // 1. Slide in with cubic easing
    Timelines.addTween(id, {
        from: 0,
        to: 1,
        duration: 300,
        easing: Transitions.Easing.outCubic,
        onUpdate: (t) => {
            panel.bgAlpha = t * 0.9;
            panel.position = Vectors.lerp(startPos, endPos, t, scratch);
        },
    });

    // 2. Pause for 1.5 seconds
    Timelines.addWait(id, 1500);

    // 3. Fling / decay panel out with velocity
    Timelines.addDecay(id, {
        from: 0,
        velocity: 1200,
        deceleration: 0.995,
        onUpdate: (x) => {
            panel.position.x = x;
        },
    });

    // 4. Fire custom event
    Timelines.addCall(id, () => {
        Events.OnNotificationDismissed.trigger(player);
    });

    // Playback control
    Timelines.play(id);
    Timelines.pause(id);
    Timelines.resume(id);
    Timelines.stop(id);
}
```

#### 2. Fluent Class Wrapper

```ts
import { Timelines } from 'bf6-portal-utils/timelines';
import { Transitions } from 'bf6-portal-utils/transitions';

const tl = new Timelines.Timeline({ loop: 2, yoyo: true })
    .addTween({
        from: 0,
        to: 100,
        duration: 400,
        delayMs: 100, // wait 100ms before starting
        easing: Transitions.Easing.outBack,
        onUpdate: (val) => {
            widget.width = val;
        },
    })
    .addWait(200)
    .addParallel([
        {
            type: 'tween',
            duration: 250,
            delayMs: 0,
            easing: Transitions.Easing.inQuad,
            onUpdate: (t) => {
                label.textAlpha = 1 - t;
            },
        },
        {
            type: 'spring',
            from: 100,
            to: 0,
            delayMs: 50, // staggered cascade start
            stiffness: 220,
            damping: 28,
            onUpdate: (val) => {
                widget.width = val;
            },
        },
        {
            type: 'decay',
            from: 0,
            velocity: 600,
            delayMs: 100, // staggered cascade start
            deceleration: 0.997,
            onUpdate: (val) => {
                widget.x = val;
            },
        },
    ])
    .play();

// Async playback resolution
await tl.playAsync();
```

---

## Module: timers

This TypeScript `Timers` namespace provides `setTimeout` and `setInterval` functionality for Battlefield Portal experiences which run in a QuickJS runtime, which does not natively include these standard JavaScript timing functions. The module uses a highly optimized, zero-allocation pre-allocated data pool evaluated at the start of every game tick (`Events.OnTickStart`) to execute and manage timers reliably, ensuring timer callback mutations immediately participate in the current tick's simulation and commit pipeline while avoiding promise overhead and dynamic memory allocation.

**Why use Timers instead of traditional delay loops?** The `Timers` module offers significant advantages: timers can be cancelled with `clearTimeout()`/`clearInterval()`, multiple timers can run concurrently without blocking, automatic error handling prevents timer failures from crashing your mod, and the familiar JavaScript API makes code more readable and maintainable. Ideal for periodic tasks, delayed actions, debouncing, and any scenario where you need cancellable or recurring delays. See the [Comparing Timers to mod.Wait()](#comparing-timers-to-modwait) section below for a detailed comparison.

Key features include automatic timer ID management, graceful error handling that prevents timer failures from crashing your mod, support for immediate interval execution, and configurable logging for debugging timer behavior. The module uses the `Logging` module for internal logging, allowing you to monitor callback errors and debug timer behavior.

> **Note:** Since this module imports and relies on `Events`, **you must use the `Events` module as your only mechanism to subscribe to game events**—do not implement or export any Battlefield Portal event handler functions in your own code. See the [Events module](../events/README.md#known-limitations--caveats).

### Example

```ts
import { Timers } from 'bf6-portal-utils/timers';

let healthCheckIntervalId = -1;
let respawnTimeoutId = -1;

export async function OnGameModeStarted(): Promise<void> {
    // Optional: Configure logging for timer callback error monitoring
    Timers.setLogging((text) => console.log(text), Timers.LogLevel.Error);

    // Start a periodic health check every 5 seconds
    // Callbacks can be synchronous or asynchronous (return void or Promise<void>)
    healthCheckIntervalId = Timers.setInterval(() => {
        const players = mod.GetPlayers();
        console.log(`Active players: ${players.length}`);
    }, 5_000);

    // Schedule a one-time event after 30 seconds
    // Callbacks can be synchronous or asynchronous (return void or Promise<void>)
    Timers.setTimeout(async () => {
        console.log('Game mode has been running for 30 seconds!');
        await doSomething();
    }, 30_000);
}

export async function OnPlayerDied(
    victim: mod.Player,
    killer: mod.Player,
    deathType: mod.DeathType,
    weapon: mod.WeaponUnlock
): Promise<void> {
    // Schedule a respawn after 10 seconds
    respawnTimeoutId = Timers.setTimeout(() => {
        mod.SpawnPlayer(victim, mod.GetRandomSpawnPoint(mod.GetTeam(victim)));
    }, 10_000);
}

export async function OnPlayerDeployed(eventPlayer: mod.Player): Promise<void> {
    // Cancel the respawn timeout if the player already spawned.
    // You can use `clearTimeout`, `clearInterval`, or `clear` - they all work the same.
    Timers.clear(respawnTimeoutId);
    respawnTimeoutId = -1;
}

export async function OnGameModeEnded(): Promise<void> {
    // Clean up intervals when the game mode ends.
    // You can use `clearTimeout`, `clearInterval`, or `clear` - they all work the same.
    Timers.clear(healthCheckIntervalId);
    healthCheckIntervalId = -1;

    // Optional: Check how many timers are still active (useful for debugging)
    const activeCount = Timers.getActiveTimerCount();
    if (activeCount > 0) {
        console.log(`Warning: ${activeCount} timers still active after cleanup`);
    }
}
```

### Immediate Interval Execution Example

```ts
import { Timers } from 'bf6-portal-utils/timers';

export async function OnGameModeStarted(): Promise<void> {
    // Start an interval that runs immediately, then every 10 seconds
    // Useful for initialization tasks that need to run right away
    Timers.setInterval(
        () => {
            // Update scoreboard, check objectives, etc.
            updateGameState();
        },
        10_000,
        true // true = immediate execution
    );
}
```

---

## Module: transitions

The `Transitions` namespace provides stateless, deterministic, side-effect-free mathematical functions for animations and physics in Battlefield Portal experiences. It has zero external dependencies and does not rely on game ticks or runtime UI state.

Key features include:

- **Linear Interpolation (`lerp`)** – Precise interpolation with support for negative values and extrapolation.
- **Frozen Easing Library (`Transitions.Easing`)** – Pure easing curves (`linear`, `inQuad`, `outQuad`, `inOutQuad`, `outExpo`, `outBounce`, `ease`, `easeIn`, `easeOut`, `easeInOut`).
- **Configurable Cubic Bezier Generator (`Transitions.cubicBezier`)** – High-precision `cubicBezier(p1x, p1y, p2x, p2y)` curve generator using Newton-Raphson iterations with bisection fallback.
- **Zero-Allocation Spring Physics (`Transitions.calculateSpring`)** – Damped harmonic physics with sub-stepped semi-implicit Euler integration, configurable physical constants, and optional `out` parameter for zero-allocation performance in tight loops.
- **Zero-Allocation Decay Physics (`Transitions.calculateDecay`)** – Continuous-time exponential friction decay integration with exact closed-form displacement and zero-allocation `out` parameter reuse.
- **Keyframe Interpolation (`Transitions.interpolateKeyframes`)** – Multi-segment timeline interpolation with boundary clamping and optional per-segment easing curves.

### Examples

```ts
import { Transitions } from 'bf6-portal-utils/transitions';

// 1. Linear interpolation
const mid = Transitions.lerp(0, 100, 0.5); // 50

// 2. Pure easing curves
const quad = Transitions.Easing.outQuad(0.5); // 0.75
const standardEase = Transitions.Easing.ease(0.5);

// 3. Custom cubic bezier curve generator
const customEase = Transitions.cubicBezier(0.25, 0.1, 0.25, 1);
const easedProgress = customEase(0.4);

// 4. Spring physics calculation (with zero-allocation scratch target)
const scratch: Transitions.SpringResult = { value: 0, velocity: 0 };
const result = Transitions.calculateSpring(
    currentValue,
    targetValue,
    currentVelocity,
    dt,
    170, // stiffness
    26, // damping
    scratch // writes to scratch without heap allocation
);

// 5. Exponential decay physics calculation
const decayScratch: Transitions.DecayResult = { value: 0, velocity: 0 };
const decayResult = Transitions.calculateDecay(
    currentValue,
    currentVelocity,
    dt,
    0.997, // deceleration coefficient per ms
    decayScratch
);

// 6. Multi-segment keyframe interpolation
const keyframes: Transitions.Keyframe[] = [
    { time: 0.0, value: 0, easing: Transitions.Easing.inQuad },
    { time: 0.5, value: 100 },
    { time: 1.0, value: 20 },
];
const currentVal = Transitions.interpolateKeyframes(keyframes, 0.25);
```

---

## Module: base-button

`UIBaseButton` is the abstract base class for all interactive button widgets in the UI subsystem (including [`UIButton`](../button/README.md) and [`UIContentButton`](../content-button/README.md)). It encapsulates the Structure-of-Arrays (SoA) button table, generational slot allocation, event handler management, and centralized `Events.OnPlayerUIButtonEvent` routing.

---

## Module: button

The `UIButton` component creates an interactive button widget. Buttons support multiple visual states (base, disabled, pressed, focused) with customizable colors and opacities for each state. Buttons automatically register themselves with the UI system. Instead of a single `onClick` callback, you attach optional handlers for **click down** (`onClickDown`), **click up** (`onClickUp`), **focus in** (`onFocusIn`), and **focus out** (`onFocusOut`), which map to `mod.UIButtonEvent` `ButtonDown`, `ButtonUp`, `FocusIn`, and `FocusOut`. Handlers may be synchronous or asynchronous; while asynchronous handlers are generally preferred elsewhere (e.g. to avoid blocking event stacks), for `UIButton` the only handler running for a given engine event is this button’s handler for that event (due to unique global button referencing), so synchronous callbacks—even long-running ones—are safe.

```ts
import { UIButton } from 'bf6-portal-utils/ui/components/button';
import { UI } from 'bf6-portal-utils/ui';

// Typical “activate on release” behavior uses onClickUp
const button = new UIButton({
    position: { x: 0, y: 0 },
    size: { width: 200, height: 50 },
    onClickUp: (player: mod.Player) => {
        console.log(`Player ${mod.GetObjId(player)} released the button!`);
    },
    visible: true,
});

// Update button state
button.enabled = false;
button.baseColor = UI.COLORS.BLUE;
button.pressedColor = UI.COLORS.GREEN;
```

---

## Module: container

The `UIContainer` component creates a container widget that can hold child elements. Containers are useful for grouping UI elements together and managing their layout as a single unit.

```ts
import { UIContainer } from 'bf6-portal-utils/ui/components/container';
import { UIText } from 'bf6-portal-utils/ui/components/text';
import { UI } from 'bf6-portal-utils/ui';

// Create a container with nested children
const container = new UIContainer({
    position: { x: 0, y: 0 },
    size: { width: 300, height: 400 },
    anchor: UI.Anchor.Center,
    bgColor: UI.COLORS.BF_GREY_3,
    bgAlpha: 0.9,
    childrenParams: [
        {
            type: UIText,
            label: mod.Message(mod.stringkeys.text.helloWorld), // 'Hello World'
            position: { x: 0, y: 0 },
            textSize: 48,
        } as UIContainer.ChildParams<UIText.Params>,
    ],
    visible: true,
});

// Access children
console.log(container.children.length); // 1

// Delete container (recursively deletes all children)
container.delete();
```

### `UIContainer.ChildParams<T extends UI.ElementParams>`

Generic type for child element parameters in `childrenParams`. The type parameter must extend `ElementParams`. The `type` property must be set to the class constructor. This generic type enables developers to create custom UI elements (like checkboxes, dropdowns, clocks, progress bars, etc.) that integrate seamlessly with the existing UI system.

```ts
type ChildParams<T extends UI.ElementParams> = T & {
    type: new (params: T) => UI.Element;
};
```

**Example:**

```ts
import { UIContainer } from 'bf6-portal-utils/ui/components/container';
import { UIText } from 'bf6-portal-utils/ui/components/text';

const container = new UIContainer({
    childrenParams: [
        {
            type: UIText,
            label: mod.Message(mod.stringkeys.text.hello), // 'Hello'
            position: { x: 0, y: 0 },
        } as UIContainer.ChildParams<UIText.Params>,
    ],
});
```

---

## Module: container-button

The `UIContainerButton` component creates a button that contains a `UIContainer` as its content. This allows you to create interactive buttons that can hold child elements, enabling complex nested UI structures within a clickable button.

```ts
import { UIContainerButton } from 'bf6-portal-utils/ui/components/container-button';
import { UIText } from 'bf6-portal-utils/ui/components/text';
import { UI } from 'bf6-portal-utils/ui';

// Create a container button with nested children
const button = new UIContainerButton({
    position: { x: 0, y: 0 },
    size: { width: 200, height: 100 },
    onClickUp: async (player: mod.Player) => {
        console.log(`Player ${mod.GetObjId(player)} released the button!`);
    },
    childrenParams: [
        {
            type: UIText,
            label: mod.Message(mod.stringkeys.labels.click), // 'Click'
            anchor: UI.Anchor.TopCenter,
            position: { x: 0, y: 0 },
            size: { width: 200, height: 50 },
        } as UIContainer.ChildParams<UIText.Params>,
        {
            type: UIText,
            label: mod.Message(mod.stringkeys.labels.me), // 'Me'
            anchor: UI.Anchor.BottomCenter,
            position: { x: 0, y: 0 },
            size: { width: 200, height: 50 },
        } as UIContainer.ChildParams<UIText.Params>,
    ],
    visible: true,
});

// Access the inner container
const innerContainer = button.innerContainer;
console.log(innerContainer.children.length); // 2
```

## Usage Notes

- **Inner Container Access**: Use the `innerContainer` property to access the container that holds child elements. You can use this to manage children, check the children array, etc.
- **Child Management**: Children added via `childrenParams` are automatically added to the inner container, not the button itself. Use `innerContainer.children` to access them.
- **Size Synchronization**: Setting `width`, `height`, or `size` automatically updates all three layers (outer container, button, and inner container), ensuring they stay in sync.
- **Padding**: The component supports padding, which creates space between the button border and the inner container. The inner container's size is automatically adjusted to account for padding.

---

## Module: content-button

The `UIContentButton` is an abstract base class for buttons that contain content elements (such as text or images). It handles the common pattern of wrapping a button and a content element in a container, managing their layout, and exposing properties cleanly on its prototype. It is needed because natively (via the `mod` namespace UI widget system) only containers can be parents and have children.

This class is not meant to be instantiated directly. Instead, use concrete implementations like `UITextButton` which extends this class, or build your own buttons with content by extending this class.

## Architecture

`UIContentButton` manages a unified three-layer visual structure as a single lightweight class handle:

1. **Container Widget** (outermost) – The wrapping native container widget
2. **Button Widget** (middle) – The interactive native button widget handling click and focus events via an SoA button slot
3. **Content Element** (innermost) – The content element handle (e.g., `UIText`, `UIImage`) displaying the button's content

The class automatically:

- Creates and manages the native container, button, and inner content elements
- Forwards button properties (colors, alphas, `onClickDown`, `onClickUp`, `onFocusIn`, `onFocusOut`, etc.) to the button widget
- Manages padding and size synchronization between all three layers
- Handles cleanup when deleted

## Constructor

The constructor is `protected` and should not be called directly. Concrete implementations should call `super()` with appropriate parameters.

```ts
protected constructor(
    params: UIContentButton.Params,
    createContent: (parent: UI.Parent, width: number, height: number) => TContent
)
```

**Parameters:**

- `params` – The parameters for the content button, including all `UIBaseButton.Params` plus optional `padding`
- `createContent` – A factory function that creates the content element given a parent and a prescribed inner width and height

## Usage Notes

- **Padding Handling**: When padding is set, the content element's size is automatically reduced by `padding * 2` (once for each side) to account for the padding space.
- **Size Synchronization**: Setting `width`, `height`, or `size` automatically updates all three layers (container, button, and content), ensuring they stay in sync.
- **Content Access**: Access the wrapped content element using `button.content` or `button.getContent()`. Internal widget handles and content references are managed via static Structure-of-Arrays (SoA) tables.

---

## Module: gadget-image

The `UIGadgetImage` component creates a widget that displays an image of a gadget (equipment item). Gadget images are useful for displaying equipment icons in the UI, such as in inventory screens or equipment selection menus.

```ts
import { UIGadgetImage } from 'bf6-portal-utils/ui/components/gadget-image';

// Create a gadget image
const gadgetImage = new UIGadgetImage({
    gadget: mod.Gadgets.Misc_Defibrillator,
    position: { x: 0, y: 0 },
    size: { width: 64, height: 64 },
    visible: true,
});
```

---

## Module: gadget-image-button

The `UIGadgetImageButton` component creates a button with an integrated gadget image. It combines `UIButton` and `UIGadgetImage` functionality into a single element, wrapping both in a container and forwarding properties cleanly.

```ts
import { UIGadgetImageButton } from 'bf6-portal-utils/ui/components/gadget-image-button';
import { UI } from 'bf6-portal-utils/ui';

// Create a gadget image button with a handler (e.g. onClickUp)
const button = new UIGadgetImageButton({
    position: { x: 0, y: 0 },
    size: { width: 64, height: 64 },
    gadget: mod.Gadgets.Misc_Defibrillator,
    onClickUp: async (player: mod.Player) => {
        console.log(`Player ${mod.GetObjId(player)} activated the Defibrillator button!`);
    },
    visible: true,
});

// Update button properties
button.enabled = false;
button.baseColor = UI.COLORS.BLUE;
```

---

## Module: image

The `UIImage` component creates a widget that displays an image. Images are useful for displaying icons, graphics, or other visual elements in the UI.

```ts
import { UIImage } from 'bf6-portal-utils/ui/components/image';
import { UI } from 'bf6-portal-utils/ui';

// Create an image
const image = new UIImage({
    imageType: UI.ImageType.QuestionMark,
    position: { x: 0, y: 0 },
    size: { width: 64, height: 64 },
    imageColor: UI.COLORS.WHITE,
    imageAlpha: 1,
    visible: true,
});

// Update image properties
image.imageType = UI.ImageType.CrownOutline;
image.imageColor = UI.COLORS.BLUE;
image.imageAlpha = 0.8;
```

---

## Module: image-button

The `UIImageButton` component creates a button with an integrated image. It combines `UIButton` and `UIImage` functionality into a single element, wrapping both in a container and delegating properties appropriately. The image automatically updates its appearance when the button is enabled or disabled.

```ts
import { UIImageButton } from 'bf6-portal-utils/ui/components/image-button';
import { UI } from 'bf6-portal-utils/ui';

// Create an image button with a handler (e.g. onClickUp)
const button = new UIImageButton({
    position: { x: 0, y: 0 },
    size: { width: 64, height: 64 },
    imageType: UI.ImageType.CrownOutline,
    imageColor: UI.COLORS.WHITE,
    onClickUp: async (player: mod.Player) => {
        console.log(`Player ${mod.GetObjId(player)} released the button!`);
    },
    visible: true,
});

// Update button and image properties
button.imageType = UI.ImageType.CrownSolid;
button.imageColor = UI.COLORS.BLUE;
button.enabled = false;
```

---

## Module: pixel-art

The `UIPixelArt` component renders high-fidelity pixel art, icons, sprites, and logos inside Battlefield Portal using a custom, high-efficiency binary image format. It transforms raster images into optimized native UI container widgets through **2D Rectilinear Painter's Decomposition**, drastically reducing engine draw calls (typically by 60%–90%).

The component supports both Base64 and ultra-compact Base122 string payloads, full alpha transparency or 1-bit cutouts, 8-bit/16-bit coordinate systems, and runtime monochrome color tinting.

### Rendering Pixel Art

```ts
import { UIPixelArt } from 'bf6-portal-utils/ui/components/pixel-art';
import { UI } from 'bf6-portal-utils/ui';

// Create a pixel art element from an encoded Base64 or Base122 string
const pixelArt = new UIPixelArt({
    data: '<BASE64_OR_BASE122_DATA>',
    position: { x: 0, y: -100 },
    size: { width: 128, height: 128 },
    anchor: UI.Anchor.Center,
    visible: true,
});

// Access diagnostic properties
console.log(`Draw calls: ${pixelArt.drawCallCount}`);

// Dynamic color tinting (monochrome pixel art)
pixelArt.setColor(UI.COLORS.GOLD);

// Delete when done (frees all native child widgets and internal pool slot)
pixelArt.delete();
```

---

## Module: pixel-art-button

The `UIPixelArtButton` component creates an interactive UI button with embedded high-performance pixel art graphics. It combines `UIBaseButton` interactivity and `UIPixelArt` two-tier throttled rendering into a single unified element, wrapping both in a root container with optional padding.

For monochrome pixel art, the button automatically synchronizes foreground tint colors when the button transitions between enabled and disabled states.

```ts
import { UIPixelArtButton } from 'bf6-portal-utils/ui/components/pixel-art-button';
import { UI } from 'bf6-portal-utils/ui';

// Create a pixel art button with an interaction handler
const button = new UIPixelArtButton({
    x: 100,
    y: 100,
    width: 64,
    height: 64,
    data: '<BASE64_OR_BASE122_DATA>',
    pixelArtColor: UI.COLORS.WHITE,
    pixelArtDisabledColor: UI.COLORS.BF_GREY_2,
    onClickUp: async (player: mod.Player) => {
        console.log(`Player clicked pixel art button!`);
    },
    visible: true,
});

// Update button and pixel art properties dynamically
button.pixelArtColor = UI.COLORS.GOLD;
button.enabled = false;
```

---

## Module: qr-code

The `UIQRCode` component renders optimized QR codes using pure dark module rendering with **greedy rectilinear rectangle merging** and **bounded overlap**. The Base Container exclusively owns the background canvas, while the QR Container renders exclusively dark module rectangles with zero light cutout widgets. This drastically minimizes native engine draw calls (reducing widget counts by 60%–85% compared to naive pixel-by-pixel rendering) while consuming only **1 slot** in the global `UI.MAX_ELEMENTS` pool.

The component encodes text payloads into QR codes using a built-in, zero-dependency QR matrix encoder supporting standard QR Versions 1–40 and error correction levels L, M, Q, and H.

### Rendering a QR Code

```ts
import { UIQRCode } from 'bf6-portal-utils/ui/components/qr-code';
import { UI } from 'bf6-portal-utils/ui';

// Create a QR code from a URL, text string, or raw bytes
const qrCode = new UIQRCode({
    data: 'https://discord.gg/example',
    ecc: UIQRCode.ECC.Medium,
    position: { x: 0, y: 0 },
    size: { width: 200, height: 200 },
    anchor: UI.Anchor.Center,
    color: UI.COLORS.BLACK,
    bgColor: UI.COLORS.WHITE,
    margin: 4, // 4 modules quiet zone
});

// Access diagnostic properties
console.log(`Draw calls: ${qrCode.drawCallCount}`);

// Dynamic dark module color mutation (throttled across server ticks)
qrCode.setColor(UI.COLORS.BLUE);

// Delete when done (frees all native widgets and slot)
qrCode.delete();
```

---

## Module: text

The `UIText` component creates a text widget for displaying text labels in the UI. Text elements support customizable font size, color, opacity, alignment, and padding.

```ts
import { UIText } from 'bf6-portal-utils/ui/components/text';
import { UI } from 'bf6-portal-utils/ui';

// Create a text element
const text = new UIText({
    label: mod.Message(mod.stringkeys.labels.helloWorld), // 'Hello World'
    position: { x: 0, y: 0 },
    textSize: 48,
    textColor: UI.COLORS.WHITE,
    visible: true,
});

// Update text properties
text.label = mod.Message(mod.stringkeys.labels.updatedText); // 'Updated Text'
text.textColor = UI.COLORS.BLUE;
text.textSize = 36;
```

## Usage Notes

- **Message Opaqueness**: `mod.Message` is opaque and cannot be unpacked into a string. You can only create messages using `mod.Message()` with numbers, `mod.Player` types, or strings in `mod.stringkeys`.
- **Padding**: Unlike the base `Element` class, `UIText` supports padding. This allows you to add space around the text content.

---

## Module: text-button

The `UITextButton` component creates a button with integrated text content. It combines `UIButton` and `UIText` functionality into a single element, wrapping both in a container and forwarding properties cleanly. The text automatically updates its appearance when the button is enabled or disabled.

```ts
import { UITextButton } from 'bf6-portal-utils/ui/components/text-button';
import { UI } from 'bf6-portal-utils/ui';

// Create a text button with a handler (e.g. onClickUp for activate-on-release)
const button = new UITextButton({
    position: { x: 0, y: 0 },
    size: { width: 200, height: 50 },
    label: mod.Message(mod.stringkeys.labels.clickMe), // 'Click Me'
    onClickUp: async (player: mod.Player) => {
        console.log(`Player ${mod.GetObjId(player)} released the button!`);
    },
    visible: true,
});

// Update button and text properties
button.label = mod.Message(mod.stringkeys.labels.updated);
button.textColor = UI.COLORS.WHITE;
button.enabled = false;
```

## Usage Notes

- **Automatic Text State Management**: When the button's `enabled` state changes, the text automatically switches between `textColor`/`textAlpha` (enabled) and `textDisabledColor`/`textDisabledAlpha` (disabled).
- **Size Synchronization**: Setting `width`, `height`, or `size` automatically updates the button widget and text size, accounting for padding.
- **Padding**: The component supports padding, which creates space between the button border and the text content. The text size is automatically adjusted to account for padding.

---

## Module: weapon-image

The `UIWeaponImage` component creates a widget that displays an image of a weapon. Weapon images are useful for displaying weapon icons in the UI, such as in weapon selection menus or loadout screens.

```ts
import { UIWeaponImage } from 'bf6-portal-utils/ui/components/weapon-image';

const weaponPackage = mod.CreateNewWeaponPackage();
mod.AddAttachmentToWeaponPackage(mod.WeaponAttachments.Ammo_Hollow_Point, weaponPackage);
mod.AddAttachmentToWeaponPackage(mod.WeaponAttachments.Barrel_11_Extended, weaponPackage);
mod.AddAttachmentToWeaponPackage(mod.WeaponAttachments.Magazine_25rnd_Magazine, weaponPackage);
mod.AddAttachmentToWeaponPackage(mod.WeaponAttachments.Right_Laser_Light_Combo_Green, weaponPackage);

// Create a weapon image
const weaponImage = new UIWeaponImage({
    weapon: mod.Weapons.AssaultRifle_AK4D,
    weaponPackage: weaponPackage,
    position: { x: 0, y: 0 },
    size: { width: 128, height: 64 },
    visible: true,
});
```

---

## Module: weapon-image-button

The `UIWeaponImageButton` component creates a button with an integrated weapon image. It combines `UIButton` and `UIWeaponImage` functionality into a single element, wrapping both in a container and forwarding properties cleanly.

```ts
import { UIWeaponImageButton } from 'bf6-portal-utils/ui/components/weapon-image-button';
import { UI } from 'bf6-portal-utils/ui';

const weaponPackage = mod.CreateNewWeaponPackage();
mod.AddAttachmentToWeaponPackage(mod.WeaponAttachments.Ammo_Hollow_Point, weaponPackage);
mod.AddAttachmentToWeaponPackage(mod.WeaponAttachments.Barrel_11_Extended, weaponPackage);
mod.AddAttachmentToWeaponPackage(mod.WeaponAttachments.Magazine_25rnd_Magazine, weaponPackage);
mod.AddAttachmentToWeaponPackage(mod.WeaponAttachments.Right_Laser_Light_Combo_Green, weaponPackage);

// Create a weapon image button with a handler (e.g. onClickUp)
const button = new UIWeaponImageButton({
    position: { x: 0, y: 0 },
    size: { width: 128, height: 64 },
    weapon: mod.Weapons.AssaultRifle_AK4D,
    weaponPackage: weaponPackage,
    onClickUp: async (player: mod.Player) => {
        console.log(`Player ${mod.GetObjId(player)} activated the AK24 button!`);
    },
    visible: true,
});

// Update button properties
button.enabled = false;
button.baseColor = UI.COLORS.BLUE;
```

---

## Module: ui

This TypeScript `UI` namespace wraps Battlefield Portal's `mod` UI APIs with an ergonomic, object-oriented interface backed by a high-performance **Structure-of-Arrays (SoA)** core. It provides strongly typed helpers, convenient defaults, ergonomic getters/setters, pre-allocated coordinate/dimension buffers, and automatic management of UI mechanics for building complex HUDs, panels, and interactive buttons with near-zero garbage collection overhead.

> **Note:** Since this module imports and relies on `Events`, **you must use the `Events` module as your only mechanism to subscribe to game events**—do not implement or export any Battlefield Portal event handler functions in your own code. See the [Events module](../events/README.md#known-limitations--caveats).

### Example

```ts
import { Events } from 'bf6-portal-utils/events';
import { UI } from 'bf6-portal-utils/ui';
import { UIContainer } from 'bf6-portal-utils/ui/components/container';
import { UITextButton } from 'bf6-portal-utils/ui/components/text-button';

let testMenu: UIContainer | undefined;

// The UI module subscribes to OnPlayerUIButtonEvent via Events automatically. Use Events for your game logic.
Events.OnPlayerDeployed.subscribe((eventPlayer: mod.Player) => {
    if (!testMenu) {
        // Can include children upon construction of the container.
        testMenu = new UIContainer({
            position: { x: 0, y: 0 },
            size: { width: 200, height: 300 },
            anchor: UI.Anchor.Center,
            receiver: eventPlayer,
            visible: true,
            uiInputModeWhenVisible: true,
            childrenParams: [
                {
                    type: UITextButton,
                    position: { x: 0, y: 0 },
                    size: { width: 200, height: 50 },
                    anchor: UI.Anchor.TopCenter,
                    bgColor: UI.COLORS.GREY_25,
                    baseColor: UI.COLORS.BLACK,
                    onClickUp: (player: mod.Player) => {
                        // Do something on release (sync or async; CallbackHandler catches errors)
                    },
                    label: mod.Message(mod.stringkeys.ui.buttons.option1),
                    textSize: 36,
                    textColor: UI.COLORS.WHITE,
                } as UIContainer.ChildParams<UITextButton.Params>,
                {
                    type: UITextButton,
                    position: { x: 0, y: 50 },
                    size: { width: 200, height: 50 },
                    anchor: UI.Anchor.TopCenter,
                    bgColor: UI.COLORS.GREY_25,
                    baseColor: UI.COLORS.BLACK,
                    onClickUp: (player: mod.Player) => {
                        // Do something on release (sync or async; CallbackHandler catches errors)
                    },
                    label: mod.Message(mod.stringkeys.ui.buttons.option2),
                    textSize: 36,
                    textColor: UI.COLORS.WHITE,
                } as UIContainer.ChildParams<UITextButton.Params>,
            ],
        });

        // And even add a child to the container.
        new UITextButton({
            parent: testMenu,
            position: { x: 0, y: 0 },
            size: { width: 50, height: 50 },
            anchor: UI.Anchor.BottomCenter,
            bgColor: UI.COLORS.GREY_25,
            baseColor: UI.COLORS.BLACK,
            onClickUp: (player: mod.Player) => {
                if (testMenu) {
                    testMenu.visible = false;
                }
            },
            label: mod.Message(mod.stringkeys.ui.buttons.close),
            textSize: 36,
            textColor: UI.COLORS.WHITE,
        });
    }

    if (testMenu) {
        testMenu.visible = true;
    }
});
```

### Property Setter & Chaining Example

Update properties directly via standard TypeScript property assignment or chain method calls:

```ts
import { UIButton } from 'bf6-portal-utils/ui/components/button';
import { UIText } from 'bf6-portal-utils/ui/components/text';

const button = new UIButton({
    position: { x: 100, y: 200 },
    size: { width: 200, height: 50 },
    onClickUp: (player) => {
        // Handle release (sync or async; errors are caught and logged by CallbackHandler)
    },
});

// Update properties directly or via fluent chaining
button
    .setPosition({ x: 150, y: 250 })
    .setSize({ width: 250, height: 60 })
    .setBaseColor(UI.COLORS.BLUE)
    .setBaseAlpha(0.9)
    .setEnabled(true)
    .setVisible(true);

// Or update text content
const text = new UIText({
    label: mod.Message(mod.stringkeys.labels.hello), // 'Hello'
    position: { x: 0, y: 0 },
});

text.setLabel(mod.Message(mod.stringkeys.labels.updated))
    .setPosition({ x: 10, y: 20 })
    .setBgColor(UI.COLORS.WHITE)
    .setBgAlpha(0.5)
    .setVisible(true);
```

### Zero-Allocation Queries with `out` Parameters

To avoid GC overhead when querying positions or sizes, pass pre-allocated destination objects:

```ts
const scratchPos: UI.Position = { x: 0, y: 0 };
const scratchSize: UI.Size = { width: 0, height: 0 };

// Populates and returns scratchPos without any new heap allocation
container.getPosition(scratchPos);

// Populates and returns scratchSize without any new heap allocation
container.getSize(scratchSize);
```

### Parent-Child Management Example

Elements automatically manage parent-child relationships. When you create an element with a parent, move it between parents, or delete it, the hierarchy is automatically maintained in the Left-Child Right-Sibling (LCRS) tree:

```ts
import { UIContainer } from 'bf6-portal-utils/ui/components/container';
import { UIText } from 'bf6-portal-utils/ui/components/text';

// Create containers
const container1 = new UIContainer({ position: { x: 0, y: 0 }, size: { width: 200, height: 200 } });
const container2 = new UIContainer({ position: { x: 200, y: 0 }, size: { width: 200, height: 200 } });

// Create a text element as a child of container1
const text = new UIText({
    label: mod.Message(mod.stringkeys.labels.hello), // 'Hello'
    parent: container1,
});

console.log(container1.children?.length); // 1
console.log(container2.children?.length); // 0

// Move the text element to container2 via parent setter or setParent
text.parent = container2;

console.log(container1.children?.length); // 0 (automatically removed)
console.log(container2.children?.length); // 1 (automatically added)

// Delete the text element
text.delete();

console.log(container2.children?.length); // 0 (automatically removed)
```

## UI Input Mode Management

The `uiInputModeWhenVisible` property provides automatic management of UI input mode (enabling the player's cursor to click buttons), eliminating the need to manually call `mod.EnableUIInputMode`.

### How It Works

- **Reference Counting**: Each receiver tracks active requesters. UI input mode is enabled when the first requesting element becomes visible, and disabled when all requesting elements are hidden or deleted.
- **Receiver-Aware Scope**: Automatically targets the appropriate scope (`Global`, `Team`, or `Player`) based on the element's receiver.
- **Lifecycle Integration**: Input mode requests are automatically registered or released when:
    - An element is created with `visible: true` and `uiInputModeWhenVisible: true`.
    - `element.visible` is toggled.
    - `element.uiInputModeWhenVisible` is toggled on a visible element.
    - `element.delete()` is called.

### Usage Example

```ts
import { UIContainer } from 'bf6-portal-utils/ui/components/container';
import { UITextButton } from 'bf6-portal-utils/ui/components/text-button';

// Create a menu with interactive buttons
const menu = new UIContainer({
    position: { x: 0, y: 0 },
    size: { width: 300, height: 400 },
    receiver: player,
    uiInputModeWhenVisible: true, // Auto-manages cursor input mode for player
    childrenParams: [
        {
            type: UITextButton,
            position: { x: 0, y: 0 },
            size: { width: 200, height: 50 },
            label: mod.Message(mod.stringkeys.labels.button1),
            onClickUp: async (p) => {
                // Handle click
            },
        } as UIContainer.ChildParams<UITextButton.Params>,
    ],
});

// Showing the menu enables UI input mode for the player
menu.visible = true;

// Hiding the menu disables UI input mode (when no other requesters exist)
menu.visible = false;
```

### When to Use

- **Enable `uiInputModeWhenVisible: true`** on the root container of an interactive menu whose visibility you toggle. Do not enable it on individual child buttons inside that container.
- Avoid mixing manual `mod.EnableUIInputMode` calls with `uiInputModeWhenVisible`, as the engine provides no way to query input mode state.

---

## Module: vectors

The `Vectors` namespace provides lightweight, high-performance utilities for working with 3D vectors in Battlefield Portal experiences. Because `mod.Vector` is an opaque engine type requiring functional Portal API calls (`mod.XComponentOf`, `mod.YComponentOf`, `mod.ZComponentOf`, `mod.CreateVector`), performing vector math can be cumbersome. This module defines a transparent, mutable `Vector3` type (`{ x, y, z }`) and a comprehensive suite of math operations.

Key features include:

- **Transparent Vector3 Type** – Plain `{ x: number, y: number, z: number }` structures for clear, intuitive math.
- **Zero-Allocation `out` Parameters** – Every transformative and arithmetic function accepts an optional `out?: Vector3` target destination to eliminate intermediate heap allocations in high-frequency game loops.
- **Engine Boundary Conversions** – Seamless bridging to and from opaque `mod.Vector` via `toVector()` and `toVector3()`.
- **Comprehensive Vector Math** – Addition, subtraction, multiplication, division, dot product, cross product, normalization, linear interpolation (`lerp`), axis rotation (Rodrigues' formula), and distance calculations.
- **Fast Squared Comparisons** – `distanceSquared()` and `lengthSquared()` avoid costly `Math.sqrt()` invocations in proximity and threshold checks.
- **String Formatting & Type Guards** – Safe runtime validation with `isVector3()` and debugging string formatting via `getVectorString()`.

### Example

```ts
import { Vectors } from 'bf6-portal-utils/vectors';

// Work with transparent Vector3 objects
const playerPos: Vectors.Vector3 = { x: 100, y: 0, z: 200 };
const offset: Vectors.Vector3 = { x: 10, y: 0, z: 0 };

// Standard immutable math
const targetPos = Vectors.add(playerPos, offset);

// Zero-allocation in-place math (reuses targetPos)
Vectors.multiply(offset, 2, targetPos);

// Convert to mod.Vector when calling Portal APIs
mod.SpawnObject(asset, Vectors.toVector(targetPos), Vectors.toVector(Vectors.ZERO));

// Fast distance check without square roots
const distSq = Vectors.distanceSquared(playerPos, targetPos);
if (distSq <= 4) {
    // Within 2 meters (2^2 = 4)
}

// Rotation from compass degrees (e.g. spawner orientation)
mod.SetVehicleSpawnerRotation(spawner, Vectors.toVector(Vectors.getRotationVector(90)));

// Convert from mod.Vector with zero-allocation target reuse
const scratch: Vectors.Vector3 = { x: 0, y: 0, z: 0 };
const soldierPos = mod.GetObjectPosition(player);
Vectors.toVector3(soldierPos, scratch);

// Debug formatting
console.log(Vectors.getVectorString(scratch, 2)); // "<100.00, 0.00, 200.00>"
```
