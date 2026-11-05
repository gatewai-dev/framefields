# Emberwake: trailer script

**Format.** 1920 × 1080 at 24 fps, picture letterboxed to 2.39:1 (1920 × 804, 138 px bars). 2:04 in all, 2976 frames: a 1:59 trailer plus a 5-second stinger.

**Structure.** A cold open, then the world, the rising, the company, the waking, the title and the stinger. Saevra narrates. The score follows a classic trailer shape: a near-silent open, a pulse, a braam at 0:42, a driving build, a hard cut to silence at 1:42, and a final hit on the title.

Frame numbers are at 24 fps, and each shot runs from its first frame up to, but not including, its out frame. "VO" is voice-over and "O.S." is off screen. **Engine** notes name the framefields features each shot uses (see the matrix at the end).

---

## COLD OPEN (0:00–0:14)

### 1. Black, a heartbeat | 0:00–0:04 | frames 0–96

Black. Silence, then one heartbeat, so deep it is felt more than heard. On the beat a few embers pulse in the dark, dim, and are gone.

> **SAEVRA (V.O., close, almost sung):** Every grave is a promise…

*Engine:* `Layer.particles` embers with emission keyed to the beat (an audio signal).

### 2. The Spine, by night | 0:04–0:09 | frames 96–216

A slow aerial crane over an endless snow ridge under a cold moon. Arches of dark rock break the snow in a long row, like ribs, because they are. Far below, a chain of tiny orange lights: a dwarven mine-road. Snow drifts across the lens, and moonlight cuts god rays through low cloud.

> **SAEVRA (V.O.):** …that something will stay where you put it.

*Engine:* ridged `Layer3D.terrain` (frost and ash `colorByElevation`), rib arches as an SDF sculpture scattered along the ridge, `volumetricFog` lit by a shadow-casting moon, snow `Layer.particles` with wind, camera on a `LayerAnimation` crane path with motion blur.

### 3. The Heartcut | 0:09–0:14 | frames 216–336

Deep inside the mountain, a spinning dwarven drill head screams against rock. The wall bursts into pieces, and orange light floods the shaft. Behind the rock is not stone but a wall of black obsidian scales. A seam of molten light runs between two of them, and it **pulses**.

Hard cut to black. A second heartbeat, much louder.

*Engine:* the rock face is `world.fracture` (impact point at the drill tip, `explosionSpeed` low, debris under gravity), with motion blur on the debris. The scales are an SDF sculpture whose emissive seams follow a `Signal` heartbeat envelope, lit by point lights with `gi` color bleed onto the drill.

---

## THE WORLD (0:14–0:42)

### 4. Lanternhold at dusk | 0:14–0:19 | frames 336–456

A wide shot of a walled human city at the foot of the mountain. As the sky goes from violet to night, lanterns light along the walls in a wave that runs from the gate up to the keep, thousands of them.

> **SAEVRA (V.O.):** The kings of Calder built their walls on her feet…

*Engine:* the walls and keep are a kitbash of `Layer3D` primitives. Lanterns are instanced emissive spheres (`Layer3D.scatter` along the wall line) whose `emissiveIntensity` follows a per-instance delay, so the wave runs under bloom. The sky gradient is keyed.

### 5. Aldric's lantern | 0:19–0:23 | frames 456–552

Close on an iron lantern on a wall-pole, in wind. A gauntleted fist closes beside it; the ember-chamber on its back flares and the wick catches. Pull focus to ALDRIC behind it: weathered and still, the flame in his eyes. He looks out toward the dark lake.

*Engine:* the gauntlet's point light casts shadows. `pose` closes the fingers on keys and `lookAt` turns the head to the lake. The lantern chain is a spring bone. Depth of field comes from the camera.

### 6. Anvilmouth | 0:23–0:28 | frames 552–672

A forge-city carved into a colossal stone jaw, its teeth turned into towers, with furnace light pouring out of every window. Down a long causeway marches the Steamguard: two hundred squat mechs in perfect step, exhaust stacks breathing sparks in rhythm.

> **SAEVRA (V.O.):** …the dwarves carved her bones into furnaces…

*Engine:* the Steamguard is a skinned crowd (`Layer3D.scatter` with `crowd: { clips: ["March"] }`, small phase offsets). Sparks are GPU particles. Furnace light is emissive with bloom and `ssr` on the wet causeway. The camera tracks with the march, and motion blur shows on the swinging legs.

### 7. "Up, ya bucket." | 0:28–0:31 | frames 672–744

Inside Old Grudge's cockpit cage. BRUNNA pulls her goggles down and slams a brass lever. The emberbone heart behind the grille kicks from coal to blaze, the two headlamps ignite, and steam bursts from every joint.

> **BRUNNA:** Up, ya bucket.

The mech **rises** into frame, enormous.

*Engine:* the heart's emissive intensity is keyed and blooms. Steam comes from `Layer.vfx` "Smoke" and particles. The mech's rise is a clip ("Stand") with `pose` overrides on the pistons. Brunna's braids are spring bones that jolt with the lever.

### 8. The Amberwood | 0:31–0:36 | frames 744–864

Golden trees as tall as towers, their leaves glowing faintly amber in the dark, swaying. Elven silhouettes stand on the high branches, perfectly still. Slow push in on ITHRAEL, standing on a branch in her antler crown. A leaf falls past her face. She doesn't blink.

> **SAEVRA (V.O.):** …and the elves sang her lullabies… and kept their secrets.

*Engine:* trees are scattered meshes with `wind` and their leaves `subsurface` amber. Ithrael's cloak and the crown's leaves are spring bones. The falling leaf is a 3D physics body with air drag. `volumetricFog` amber light shafts. Her head `lookAt` follows the leaf for a beat and then returns.

### 9. A squirrel | 0:36–0:39 | frames 864–936

On a branch nearby, a red squirrel washes its whiskers. Pure nature documentary. Its head snaps toward camera. A catchlight in the huge black eye. The tail flicks once, and the movement uncovers a tiny silver thorn dagger strapped against its flank.

Cut before anyone can react.

*Engine:* WHISK's head snaps with a tight `lookAt` (`maxAngleDeg`, a hard ease), whisker twitches are `pose` on `Signal.sine` noise, the tail is a spring-bone chain, and the fur is `sheen`. A macro camera with shallow depth of field.

### 10. Hollowmere | 0:39–0:42 | frames 936–1008

An ash-grey ruin on a frozen lake. Among its broken houses stand ash statues: people frozen mid-step and mid-embrace, a mother holding a child. SAEVRA walks slowly between them, touching each one as she passes, prayer-ribbons trailing behind her.

> **SAEVRA (V.O.):** They called it mercy, when they burned my city.

She stops. Looks up into the lens.

> **SAEVRA:** I call it… a debt.

*Engine:* the statues are ash-material human models posed with `pose` (one rig, many held poses), with snow particles. Saevra's walk is retargeted from a performer video (`person.retarget`) or a walk clip. Ribbons are spring bones with wind. Cold blue `volumetricFog` at ground height.

**MUSIC: BRAAM on the cut.**

---

## THE RISING (0:42–1:12)

### 11. The note | 0:42–0:46 | frames 1008–1104

Close on Saevra. She opens her mouth and **sings**: one pure, high note. Pale light rises from her throat like breath in the cold. A ring of soul-pale light ripples out across the ash at her feet, and the ash statues crumble as it passes them.

*Engine:* her throat's emission and the ring's radius follow the sung note's envelope (an audio signal from the VO stem). The ring is an emissive torus scaled on a track. The statues fracture in the ring's path (each one's `fractureFrame` comes from its distance to her). Bloom.

### 12. The Hollow Choir | 0:46–0:51 | frames 1104–1224

A wide shot of the ash plain. The ground splits in a thousand places, and the dead of Hollowmere **rise** in unison, then turn their heads toward her at the same moment. They don't roar. They hum, and the hum becomes the choir in the score.

*Engine:* a 2,000-instance skinned crowd: "Rise" with seeded `animOffset` delays spreading outward from Saevra, then "Turn." The ground cracks are an emissive soul-pale texture drawn in along the ring. Camera crane up and back. Motion blur on the rising bodies.

### 13. Kesh | 0:51–0:55 | frames 1224–1320

The frozen lake. The ice bulges, cracks and **explodes** upward as a dragon skeleton bursts through it, blackened bone streaming water and ice. Its wings unfold: bare finger-bones strung with membranes of pale, rippling light. It throws back its head and *keens*, a high, broken, child's cry.

(A frame-perfect detail, hero-lit for half a second: an old amber arrowhead lodged in one of its ribs.)

*Engine:* the lake surface is a large `world.fracture` slab (`impactPoint` under Kesh, high `momentumTransfer`), with motion blur on the shards, SSR on the wet ice, and ember particles in the ribcage. Wings are posed with `pose` keys, and the spine and tail are spring bones. The keen's audio drives the membranes' emission.

### 14. The lanterns go out | 0:55–0:58 | frames 1320–1392

Lanternhold's wall from the lake side. The lanterns go out one by one, in a wave rushing toward camera. Last, high on a balcony of the keep, a crowned silhouette, KING OSRIC, steps back into the dark.

*Engine:* the same lantern instances as shot 4, with emission keyed out in reverse order. Bloom falls away as they die.

### 15. "Light them." | 0:58–1:01 | frames 1392–1464

Close on Aldric. Snow hits his face. The lanterns die along the wall behind him. He doesn't turn.

> **ALDRIC:** Light them. All of them.

Watch soldiers sprint past camera with torches.

*Engine:* the soldiers are a crowd on "Run" with camera motion blur. `lookAt` keeps Aldric's head fixed while his body stands braced against the wind.

### 16. The wall breaks | 1:01–1:05 | frames 1464–1560

From the battlements: the Choir hits the base of the wall like a tide. The wall section **bursts**, and stone blocks and soldiers tumble down into the mass of the dead.

*Engine:* the wall section is a `world.fracture` with its impact on the Choir's front line, soldiers as 3D physics bodies, motion blur, and dust from `Layer.vfx` "Dust" composited over the debris.

### 17. Overhead | 1:05–1:08 | frames 1560–1632

Looking straight up from the wall walk. Kesh dives over the battlements. A wing passes over camera so close it fills the frame, and its membranes light the snow pale for an instant.

Black.

*Engine:* an animated wing pass close to the lens with heavy camera motion blur (`shutter: 270`) and a fully occluded frame used as the cut.

### 18. The warden | 1:08–1:12 | frames 1632–1728

Ithrael on the wall, lit cold blue by Kesh's light, watching the dragon with no expression at all. Aldric is beside her.

> **ALDRIC:** You said she couldn't wake.
>
> **ITHRAEL:** *(a beat; she does not look at him)* I said I would not let her.

*Engine:* a two-shot with the key light from Kesh's emissive wings, `lookAt` on both heads (Ithrael's locked on the dragon, Aldric's on her). Depth of field.

---

## THE COMPANY (1:12–1:42)

The score drives. Cuts land on the beat.

### 19. Old Grudge | 1:12–1:15 | frames 1728–1800

Old Grudge vaults off a ledge into the battle. It lands, and the ground cracks under it. It swings the hammer-fist straight into a bone knight, which **explodes** into fragments.

> **BRUNNA:** *(laughing)* HA!

*Engine:* the jump is a physics body with a keyed arc, and the landing's impact signal drives the mech's `pose` recoil and a camera shake. The knight is a `world.fracture` hit by a kinematic fist (`momentumTransfer`). Motion blur.

### 20. The arrow | 1:15–1:17 | frames 1800–1848

Ithrael draws. The arrow forms out of amber light along the string. She releases, and the arrow streaks away across the frame.

*Engine:* her draw arm uses an IK `chain` to the string point. The arrow is an emissive capsule at 4,000 px/s with motion blur (the streak is the shot) and a particle trail.

### 21. The shield | 1:17–1:20 | frames 1848–1920

A dead giant swings a tree-trunk club down at Aldric. He takes it on his shield, sinking to one knee. The lantern at his belt **flares** white-hot, and the giant's arm catches fire.

*Engine:* the hit's impact signal drives `pose` on Aldric's spine and knees (a flinch weighted by the impact). The lantern's point light intensity is a spike. Fire from `Layer.vfx` "Fire."

### 22. "Was that a squirrel?" | 1:20–1:25 | frames 1920–2040

Brunna, thrown from the cockpit, flat on her back in the snow. A huge bone knight raises a two-handed sword over her.

Behind its helm, the smallest shadow.

WHISK drops onto the crown of the helm. *Tik. Tik.* Two flicks of a thorn dagger. A pause. Whisk steps off backward into the air.

The knight **falls apart**, every bone at once, into a heap.

Whisk lands, and bows.

> **BRUNNA:** *(staring)* …Was that a squirrel?
>
> **ALDRIC:** *(O.S., not looking)* Don't.

*Engine:* the knight is a `world.fracture` with zero `explosionSpeed`, so it collapses straight down under gravity. Whisk's bow is a `pose` held with `mode: "rest"`, and the tail spring bones overshoot and settle. The comedy timing (beat, pause, collapse) is set in frames in `timing.ts`. The music drops out for the pause.

### 23. The Hushtails | 1:25–1:28 | frames 2040–2112

Seven squirrels in matching charcoal cowls drop from the dark on silk lines in perfect formation. As they fall they throw acorn-cap bombs into the Choir, which burst into poison-green smoke.

*Engine:* a small crowd with phase-offset "Drop" clips and spring-bone tails. The acorns are 3D physics bodies. The bursts are `Layer.particles` with an emissive green.

### 24. Jaw to fist | 1:28–1:32 | frames 2112–2208

Kesh lands on the wall and lunges. Old Grudge catches its jaw in both hands, its feet skidding back on the stone, sparks pouring from the overloaded joints. The heart behind the grille burns white.

*Engine:* the mech's arms are an IK pair on the jaw bones' world positions, and its feet slide on a keyed track. Sparks are particles emitted at the arm joints. The heart's emission is keyed to bloom past white.

### 25. The cantor in the sky | 1:32–1:36 | frames 2208–2304

Saevra stands on Kesh's back as it climbs above the city, singing. Lightning tears the clouds. Below them, the whole mountain **shudders**: snow pours in avalanches down every ridge at once.

*Engine:* `Layer.vfx` "Lightning" lights the clouds, and its flashes drive a directional light's intensity. Avalanches are particles shed from the terrain's ridgelines, plus camera shake.

### 26. Eyes | 1:36–1:39 | frames 2304–2376

Five extreme close-ups of eyes, one per beat: Aldric (frames 2304–2319), Brunna (2319–2334), Ithrael (2334–2348), Whisk (2348–2362), and Saevra, whose irises flare pale (2362–2376).

*Engine:* five camera cuts in one scene, each with its own focus, catchlight from an area light, and `subsurface` skin.

### 27. The mountain opens | 1:39–1:42 | frames 2376–2448

A great slab of the mountainside **splits** and slides away. Beneath it, molten-orange light pours from a seam of black scales.

*Engine:* the slab is a `world.fracture` with a large `cells` count, kinematic and animated, so the pieces wake from the slab's motion. The emissive scales are lit with `gi` bouncing orange onto the snow.

---

## THE WAKING (1:42–1:54)

### 28. Silence | 1:42–1:44 | frames 2448–2496

**Hard cut to silence.** A wide shot of the whole battlefield, frozen. Snow hangs in the air. Every soldier, every dead thing, Kesh, all of them stop and turn toward the mountain.

*Engine:* time freezes: particles' `speed` and the crowds' `animSpeed` are keyed to 0.02, with motion blur off for one beat (camera `shutter` keyed to 0).

### 29. She rises | 1:44–1:49 | frames 2496–2616

The camera pulls back and back. The whole ridge of the Spine lifts. It is a neck. A head the size of the keep rises out of the mountain, avalanches of rock and snow sliding off its scales, and the light inside it glows through every seam. Lanternhold is a toy at her feet.

*Engine:* the head is an SDF sculpture with a terrain shell that fractures off on its kinematic rise (`world.fracture` over the animated layer). `volumetricFog` god rays cut between the horns. The scale comes from crowds of tiny soldiers and snow particles. A long camera pull with motion blur.

### 30. "Who took my child?" | 1:49–1:54 | frames 2616–2736

Extreme close-up. An eye the size of a cathedral door opens: molten gold, with a black slit that narrows to focus on the wall.

> **VHARRA (V.O., three layers, impossibly slow):** Who… took… my child?

On the wall, slowly, every head turns: Aldric's, Brunna's, Whisk's, Saevra's from Kesh's back, even the dead's. They all look at **Ithrael**.

Ithrael closes her eyes.

*Engine:* the eyelid shell is `pose`-keyed. The pupil's slit is a scale animation. Every head turn is a `lookAt` whose target is keyed to Ithrael at staggered frames, and the crowd's heads turn with it. Vharra's voice drives camera shake through an audio signal.

---

## TITLE (1:54–1:59)

### 31. EMBERWAKE | 1:54–1:59 | frames 2736–2856

Black. Embers drift in from the edges and gather into extruded, cold, dark-iron letters: **EMBERWAKE**. The letters **crack** along seams, and ember-light pours out of the cracks. The final hit of the score lands.

Under it, small: *The mountain remembers.*

*Engine:* `Layer3D.extrudedText` in a display font, fractured (`world.fracture` with a low `explosionSpeed` so the pieces only part along the seams), and an emissive interior color (`interiorColor` hot ember, bloom). Embers are `Layer.particles` with attractors on the letters. Motion blur.

---

## STINGER (1:59–2:04)

### 32. An offering | 1:59–2:04 | frames 2856–2976

Quiet. A warm stone ledge under falling snow. Whisk sits on it, cracking an acorn, tail curled around her.

The ledge **breathes**. It is a nostril. Whisk stops chewing.

Beside her, an eye the size of a door opens, molten gold, and fixes on her.

A long beat. Whisk slowly holds the acorn out toward it.

The pupil narrows.

Cut to black. A single tiny *crunch*.

*Engine:* the snout breathes through `pose` on a nostril joint (a slow sine), with warm `volumetricFog` exhaling. Whisk's freeze is held with `pose` `mode: "rest"` while only the tail tip keeps moving (spring bones). The eye reuses shot 30's.

---

## Audio

### Voice (AI Gateway, `google/gemini-3.8-flash-tts`)

| Who | Lines | Direction |
| --- | --- | --- |
| Saevra | 1, 2, 4, 6, 8, 10 | Close to the mic, soft, tender, almost sung, with no menace in it, which is what makes it frightening. Pauses where the script has ellipses. |
| Saevra (sung) | 11 | One sustained pure note, no words. Generated or synthesized, and pitched to the score's key. |
| Aldric | 15, 18, 22 | Low, gravel, tired. "Light them. All of them." is the one line he raises his voice on. |
| Brunna | 7, 19, 22 | Bright, quick, a rolling burr. |
| Ithrael | 18 | Soft, precise, musical, no contractions, a long pause before the line. |
| Vharra | 30 | Three layers of the same read, pitched -12, -19 and -24 semitones, very slow, with ground rumble under it. |

Word timestamps are verified with `elevenlabs/speech-to-text/scribe-v2`, and cuts are timed to the words, as in example 35.

### Music (`google/lyria-3.5`, instrumental)

| Time | Cue |
| --- | --- |
| 0:00–0:14 | Near silence, heartbeat subs, a low string drone. |
| 0:14–0:42 | A pulse enters, slow-building low strings, a lone solo voice (no lyrics). |
| 0:42 | **Braam.** Full choir enters on Saevra's note. |
| 0:42–1:12 | Percussion and choir building, staccato strings. |
| 1:12–1:42 | Full drive: taikos, brass ostinato, cuts on the beat. A dropout of about 0.8 s at shot 22's pause. |
| 1:42 | **Hard silence.** Only wind and a single heartbeat. |
| 1:49–1:54 | Sub rumble under Vharra's voice. |
| 1:54 | **Final hit** on the title crack, a long ringing tail. |
| 1:59–2:04 | Silence, falling snow, foley only. |

The generated track is measured for tempo and the drop (as in example 35's scene 7), and the braam and the cuts in shots 19–27 are placed on its beats.

### Sound effects (synthesized locally)

Heartbeats (sine subs), the drill whine, cracking rock and ice, wind, the lanterns igniting, mech servos and steam, bone collapses, the squirrel foley (*tik*, silk, crunch), Kesh's keen (pitched, granular), and the Ember-Mother's rumble.

---

## Engine feature matrix

| Feature | Shots |
| --- | --- |
| Terrain, SDF sculpture, scatter with wind | 2, 3, 6, 8, 25, 27, 29 |
| Skinned crowds | 6, 12, 15, 23, 28, 30 |
| Character posing (`pose`), `lookAt`, IK, spring bones | 5, 7, 8, 9, 10, 18, 20, 21, 22, 24, 30, 32 |
| Pose retargeting from vision | 10 (Saevra's walk), plus any performer-driven shot |
| Voronoi fracture (static and kinematic, animated) | 3, 11, 13, 16, 19, 22, 27, 29, 31 |
| 3D physics (Rapier) | 8, 16, 19, 23 |
| Per-object shutter motion blur | 2, 3, 6, 13, 15, 16, 17, 19, 20, 24, 29, 31 |
| Volumetric fog and god rays | 2, 8, 10, 29, 32 |
| SSR and diffuse GI | 3, 6, 13, 27 |
| GPU particles and procedural VFX | 1, 2, 6, 7, 13, 16, 20, 21, 23, 24, 25, 31 |
| Audio-driven signals | 1, 3, 11, 13, 30 |
| Extruded type | 31 |
