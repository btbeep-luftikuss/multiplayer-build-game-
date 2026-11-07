# Clawstruction

A couch co-op party game for 2–8 players. Build **one** free-standing tower together with swinging claws, and get it over the finish line before the clock runs out.

The **TV** (any big screen with a web browser, such as a laptop plugged into the TV) shows the game. Every player's **phone** is their controller: scan the QR code on the TV, type a name, and you're in. Nothing to install.

## How to play

- Everyone has a **claw** hanging on a rope from the bar at the top of the screen, and their own **spawn shelf** out at the edge of the field (shelves stack up like stairs on both sides, leaving the middle for building), stocked with a kit of pieces nobody else has (wood, stone, steel, toys, ice, bricks, junk, candy).
- **Tap a piece** on your phone to get it. It appears on your shelf, one at a time: pick it up before you take the next.
- Swing it over to the build pad and **let go**. Pieces stack, slide, tip and topple, all fully simulated.
- Grab anything, anywhere: your pieces, other people's, even pieces already in the tower. Two claws can lift a heavy base together.
- Once the tower has been over the finish line for **3 seconds**, a **5-second hold** starts: every claw lets go and pulls up, and the helpers vanish. If the tower is still over the line at the end, **everyone wins** right away. If it falls, the claws come back and you keep building.
- When the clock hits zero the same check happens one last time. Build higher for 2 and 3 stars.

### Levels mode

Switch the TV lobby (or the first player's ⚙ on their phone) from **Free Play** to **Levels**: ten handcrafted challenges, each with its own time limit, height goal, pieces and mechanics. Beat a level to unlock the next. The level select shows which levels are done and the team's best time for each; progress is saved on the TV.

| # | Level | What's new |
|---|---|---|
| 1 | Training Grounds | Flat ground, plenty of time, simple blocks |
| 2 | Windy Heights | Gusts that change direction push the tower, harder the higher it gets |
| 3 | Soft Ground | The base is springy jelly: heavy pieces sink where they land |
| 4 | Rotating Platform | The base slowly rocks from side to side (in a side view, that's how it turns) |
| 5 | Magnetic Blocks | Red N and blue S blocks: opposites pull together, same colours push apart |
| 6 | Shrinking Time | Much less time, and lava rises up the sides, burning anything that touches it |
| 7 | Dual Gravity Zones | Normal gravity on the left, floaty low gravity on the right |
| 8 | Moving Target Line | The finish line drifts up and down; only the moment time runs out counts |
| 9 | Unstable Claws | Grips slip and ropes stretch at random; glass shatters on hard hits |
| 10 | Final Challenge | Wind, the rocking base, magnets and lava together, with the least time |

Beating Level 10 opens the **Endless Remix**: a random mix of two or three of those mechanics, a little harder after every win. A new **Super Claw** power-up can turn up in any game: tap it on your phone and for 20 seconds your claw is faster, quicker on the rope, and grips harder without slipping.

### Phone controls

| Control | What it does |
|---|---|
| **The big pad** | Drag left or right (from anywhere on it) to run your claw along the top bar; it swings when you stop. Drag up to reel the rope in (lift), down to let it out (lower); heavy loads reel in slower. Diagonally does both. |
| **GRAB** | Closes the claw on whatever is between its fingers. Tap again (**LET GO**) to drop it. |
| **DROP ⤓** | Claw-machine style: lowers the claw on its own, then grabs what it lands on (or lets go of what it carries, gently). |
| **⟲ ⟳ turn** | Spins the piece waiting on your shelf 45° (it sits on a turntable). Pieces can only be turned there, not once they're in the claw. |
| **0° button** | Sets which way up new pieces arrive (shown on the cards). |

The phone shows your claw's state, the **rope** strain and how hard your **grip** is working (an off-centre grab on a heavy beam slips). On the TV your claw, its name tag and the outline of whatever you're holding are in your colour, and a dotted line shows where your piece will land.

The more players there are, the wider the build pad and the fewer pieces each player gets (2 players get their full kit, 8 players about half each). The TV camera zooms in when the claws are close together and out as they spread across the field.

### Power-ups

Every 35–55 seconds someone gets a special piece (and a rescue after a collapse):

- **Sticky Goo**: glues itself to every piece it touches.
- **Magnet**: snaps nearby pieces to itself and holds them fast.
- **Balloon**: ties itself to a piece and takes most of its weight.
- **Support Beam**: stand it on the ground and it props the tower up for 20 seconds.

Balloons and support beams go away when time runs out: the tower has to stand on its own.

### Settings (TV lobby, or the leader's phone)

Round time (2–6 minutes), finish line height (low, medium, high; it also rises with more players), power-ups on or off.

## Putting it online (GitHub Pages)

The game is a static website, so GitHub Pages can host it for free:

1. In this repository on GitHub: **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**, pick the **main** branch and the **/docs** folder, and save.
3. After a minute the game is at `https://<your-user>.github.io/<this-repo>/`. Open that on the TV and scan the QR code with your phones.

Phones and the TV find each other through PeerJS's free public server, then talk directly (WebRTC), so they don't even have to be on the same Wi-Fi. They do all need internet access.

## Development

```sh
npm install
npm run dev      # rebuilds on change, serves http://localhost:8080
npm test         # physics and game-rule checks in Node
node tests/browser.cjs   # optional: plays through the TV and two phones in Chromium (needs Playwright and the dev server)
npm run build    # bundles into docs/ (commit docs/ so GitHub Pages serves it)
```

To try it on one computer without phones, open `http://localhost:8080/?local` (the TV) and then `http://localhost:8080/?join=CODE&local` in other tabs or windows (each one is a phone; resize them narrow). `?local` connects tabs directly, without the internet. Add `?keys` to the TV's address for a keyboard player (arrows or WASD, Space grab, X drop, Q/E turn, 1–9 pieces).

### How it's built

- `src/sim/sim.js`: the physics, on [planck.js](https://piqnt.com/planck.js/) (a JavaScript Box2D). Claws are dynamic bodies on rope joints from kinematic trolleys; a grip is a revolute joint with a torque-limited motor (so heavy, off-centre loads slip); a little gyro keeps claws upright.
- `src/sim/game.js`: rounds, the clock, the final check, power-ups, refills, players coming and going.
- `src/host/`: the TV: [three.js](https://threejs.org/) cartoon rendering of the 2D world (toon shading, outlines), the on-screen display, and synthesized sound (no audio files).
- `src/phone/`: the controller.
- `src/net/net.js`: [PeerJS](https://peerjs.com/) rooms (the TV hosts, phones connect), plus a same-computer mode for testing.
- `src/shared/pieces.js`: all the pieces, materials and kits.
- `src/shared/levels.js`: the ten levels and the remix: time, height, pieces and mechanics.
