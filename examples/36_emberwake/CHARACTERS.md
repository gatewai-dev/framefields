# Emberwake: characters

Every character is original. Each entry gives their look (for modeling and materials), personality and voice (for VO casting), their secret, their role in the trailer, and build notes for the engine (rig, constraints, materials).

Palette for the whole film: **ember** (#ff7a2e → #ffc46b, emissive), **frost** (#9fb8d6, #e9f1fa), **ash** (#6b6866, #2a2828), **amber** (#d99a2b, #f4c869), and **soul-pale** (#bfe8e0, emissive, the necromancer's color). Every faction owns one of them.

---

## Aldric Venn, the Last Lantern (human)

*Captain of the Lantern Watch, Calder. 54.*

**Look.** Broad, heavy and slow until he isn't. Grey stubble, a broken nose, and a burn scar up the left side of his neck that he keeps under a wool collar. Dented steel plate over a padded gambeson, the Watch's soot-black tabard with a hand-stitched lantern on it. An iron lantern hangs from his belt on a chain. His left gauntlet has a brass ember-chamber on the back, so he can light a lantern or a sword by closing his fist. He carries a longsword and a battered kite shield.

**Personality.** He is tired of all of it, but he does it anyway. Few words, dry humor, and he listens more than he speaks. He trusts nobody on this wall, himself least.

**Voice.** Low, gravelly and unhurried, worn down by forty winters of shouting into wind. He never raises it except once.

**Secret.** He held Hollowmere's gate shut the night the king burned it. He heard the people on the other side. He has never told anyone, and he still dreams it.

**In the trailer.** He lights the first lantern, gives the order "Light them. All of them," blocks a dead giant with his shield, and is the one who asks the elf the question.

**Build notes.** A humanoid rig on Mixamo names, so `pose`, `aim` and `retargetPose` work unchanged. Spring bones on the tabard and the belt lantern's chain. The ember gauntlet is emissive and drives a point light that casts shadows. Plate armor is metallic 0.9 / roughness 0.35, with `clearcoat` on the brass.

---

## Brunna Coalhand and Old Grudge (dwarf with a mech)

*Forge-mother of the Coalhand clan, Anvilmouth. 211, "young for it."*

**Look (Brunna).** Short, round and strong, with forearms like hams. Her copper-red beard is braided into two thick ropes with brass rings and clipped back over her shoulders out of the machinery's way. Soot goggles sit on her forehead. She wears a leather apron over chainmail, and her left hand is a mechanical prosthetic of bone and brass from a forge accident. She wears it with pride.

**Look (Old Grudge).** Four meters tall, hunched and heavy: an iron furnace on two thick legs, with long piston arms that end in a hammer-fist (right) and a three-fingered claw (left). The cockpit is an open cage in the chest. The emberbone heart is visible behind a grille of runes and glows like a coal. Exhaust stacks on its back breathe sparks. It has two round headlamp "eyes." Its hull is patched plate covered in clan runes, scratched tally marks and one painted daisy.

**Personality.** Loud, warm and practical. She trusts machines more than people and her mech more than both. She talks to Old Grudge like a stubborn old dog. Under the noise she has the Heartcut on her conscience.

**Voice.** Quick and bright, with a rolling burr, and she laughs in the middle of sentences. She shouts over machinery even when it is quiet.

**Secret.** Her drill broke into the Heartcut, and she felt the wall beat. She told the council, and the council told her to keep digging.

**In the trailer.** "Up, ya bucket." The mech wakes. It vaults off a cliff and punches a bone knight to pieces. She ends up flat on her back under a sword until a squirrel saves her ("…Was that a squirrel?"), then wrestles the bone dragon's jaw.

**Build notes.** Old Grudge is a rigged GLB (or built from `Layer3D` primitives with `GlbBuilder`): IK on both arms, `aim` on the head lamps, and `pose` on the pistons driven by physics impact signals so the mech recoils when it hits. The heart is emissive and blooms. The exhaust stacks emit `Layer.particles` sparks. Punches are `world.fracture` targets. Brunna rides in the cockpit as a child layer with `lookAt` aimed at the target, and her beard braids are spring bones.

---

## Ithrael Sunmourn (elf)

*Warden of the Long Sleep, the Amberwood. 912.*

**Look.** Tall, too still, and with an age that is hard to place. Pale-gold skin and white hair cut short at one side. She wears a crown of shed antlers threaded with living amber leaves that never fall. Her armor is layered bark lacquer, amber resin over dark wood, in shapes like closed petals, with a long moss-green cloak. She carries a recurve longbow of pale horn. Her arrows are amber light that crystallizes when fired. One gold tattoo runs down her right arm, a ring for every century.

**Personality.** Calm, courteous and distant. She has outlived everyone she ever loved, and she has decided that a city is a small price for a sleeping god. She isn't cruel; she is certain. The trailer should leave the audience unsure whether she is an ally.

**Voice.** Soft, precise and musical, with long pauses. She never uses contractions.

**Secret.** Nine hundred years ago she shot Kesh, the Ember-Mother's last hatchling, so the mother's grief would put her to sleep. It worked. She has kept the mountain asleep ever since.

**In the trailer.** Lit cold-blue: "I said I would not let her." She fires the amber arrow. In the last shot every head turns toward her, and she closes her eyes.

**Build notes.** The cloak and antler leaves are spring bones, and the leaves get scatter-style wind. Bark armor uses `clearcoat` over a dark base, and the amber inlays use `subsurface` with an amber `subsurfaceColor`. The arrow is an emissive capsule with camera motion blur and a `Layer.particles` trail. `lookAt` on the head for the stillness: she watches things and doesn't fidget.

---

## Whisk, of the Order of the Quiet Acorn (squirrel assassin)

*Red squirrel. Field rank: Hushtail. Age: "enough."*

**Look.** Thirty centimeters of red-copper fur with a cream belly, ear tufts, and an enormous tail that does most of her talking. She wears a tiny charcoal hooded cowl with two holes for the ear tufts, a leather bandolier of acorn-cap poison vials and a black silk scarf. She carries twin thorn daggers, real rose thorns set in silver. Her eyes are huge and black with a single catchlight. She looks exactly like a squirrel and kills like a nightmare.

**Personality.** Silent and professional, with a ritual bow after every kill. She never speaks; she communicates with tail flicks and one slow blink. She is terribly vain about her tail. Whenever there is a lull she is eating something.

**Voice.** None. Her sound is foley: a whisper of silk, the *tik* of claws on stone, and the crunch of an acorn.

**Secret.** She has a contract tonight, and it is on Ithrael. The Order wants the mother awake, because the heart-tree is dying.

**In the trailer.** She cleans her whiskers in the Amberwood and reveals a thorn dagger. She drops onto a bone knight's helm, gives two flicks, and bows while it collapses into bones. She leads the Hushtails' drop from the canopy. In the stinger, she offers an acorn to a dragon's eye.

**Build notes.** The tail is a chain of spring bones, the hero element, with high damping for a silky follow-through. `pose` drives the ear and whisker twitches from `Signal.sine` noise between beats. `lookAt` uses a tight `maxAngleDeg`, so the head snaps like a real squirrel's while the body stays still. Fur is `sheen` with `sheenColor` warm. The cowl is cloth sheen.

### The Hushtails (supporting)

- **Old Nib.** The Order's grandmaster, a grey squirrel with one eye and a monocle. He is never seen fighting, which is worse.
- **Bramble.** A huge, round fox squirrel who eats his targets' snacks first.
- **Tansy.** A flying squirrel and the Order's poisoner. She glides in on silk and is gone before the twitch.
- **The rest.** Seven Hushtails in matching cowls drop from the canopy on silk lines in formation (a crowd with its own phases).

---

## Saevra Duskwyn, the Pale Cantor (necromancer)

*Former healer of Hollowmere. 38.*

**Look.** Gaunt and beautiful in a frightening way. Her dark hair is grey at the roots and loose. Ash is smeared across her eyes like a mask, and her lips are stained soul-pale. She wears a healer's grey robe, burnt at the hem, under a mantle sewn from the scorched ribbons of Hollowmere's prayer-flags, each one stitched with a name. She carries a staff made of a city bell's clapper on a length of charred beam, and when she strikes it the dead stand. When she sings, pale light flows from her mouth like breath in the cold, and her throat glows soul-pale from the inside.

**Personality.** Gentle, and that is the horror of her. She speaks to the dead tenderly, like patients. She isn't mad; she is clear-eyed and grieving, and she believes she is owed a reckoning. Of everyone on the field, she is the one person the audience half wants to win.

**Voice.** Soft, close to the mic, almost singing. She is the trailer's narrator. Her one sung note is the film's signature sound: a pure tone that the score's choir answers.

**Secret.** She doesn't know who killed Kesh, and she assumes it was the crown. When she learns it was the elves, the whole war changes.

**In the trailer.** She narrates throughout. She walks among the ash statues of Hollowmere, sings the Hollow Choir awake, rides on Kesh's back over Lanternhold, and is the first one to look up when the mountain moves.

**Build notes.** The mantle ribbons are long spring-bone chains with wind. Her singing drives everything through signals: `Signal.*` envelopes on her song drive throat emission, the shockwave ring and the Choir's rise weights. Pale light is emissive `#bfe8e0` with bloom and volumetric fog lit from below. Her walk can be retargeted from a performer video (`person.retarget({ rig: "mixamo" })`) for an unsettling human gait.

### The Hollow Choir

The dead of Hollowmere: townsfolk in burnt clothes, crusted with ash and frost, their eyes glowing faint soul-pale. They don't snarl. They hum. Thousands of them, built as a skinned crowd scattered on the ash plain with clips "Rise," "Shamble," "March" and "Turn," phase-offset, every head `lookAt` toward Saevra. Some are armored bone knights from Hollowmere's garrison, and two are giants (dead ogres from the fighting pits).

---

## Kesh, the Hatchling (undead dragon)

*Vharra's last child. Dead for nine hundred years.*

**Look.** A young dragon's skeleton the size of a warship, blackened bone with frost in the joints. The wings are bare finger-bones strung with tattered pale membranes of song-light that glow and ripple. Embers still smolder deep in the ribcage, where a fire never quite went out. One of the ribs is snapped, with an ancient amber arrowhead still lodged in it. That is the clue: amber is elven. An attentive viewer can spot it in shot 13.

**Personality.** Confused, like a child. It cries rather than roars, a high, broken keen. It obeys Saevra's song, but it keeps turning its head toward the mountain.

**In the trailer.** It bursts up through the lake ice, dives over Lanternhold's wall, and fights Old Grudge jaw-to-fist.

**Build notes.** It needs a long-necked rig. Spine and tail are spring-bone chains. `aim` on the head runs toward the mountain on the beat (a pull against the song). The ice lake is a `world.fracture` slab with a `momentumTransfer` burst from below. The wing membranes are thin emissive planes with `iridescence`. Embers are particles inside the ribs.

---

## Vharra, the Ember-Mother (elder dragon)

*The mountain.*

**Look.** Mostly unseen. A ridge of black rock, a rib-arch in the snow, a warm stone that beats once. When she wakes, rock slides off obsidian scales lit from inside like cooling lava along every seam. Her head is the size of Lanternhold's keep, crowned with horns that people had taken for spires of rock. Her one eye is molten gold with a black slit, and it opens with the slow weight of a door the size of a cathedral.

**Voice.** Not a roar. A deep, layered, very slow voice heard as much in the ground as in the air: three pitched layers, with stones rattling underneath. She speaks only once.

**In the trailer.** She is felt throughout and seen only at the end: "Who… took… my child?"

**Build notes.** Her body is the terrain. The Spine is a ridged `Layer3D.terrain` whose scales are an SDF sculpture underneath. Waking is fractured rock slabs sliding off (fracture with a kinematic, animated stand-in), an emissive crack texture drawn in on a track, and camera shake. The eye is a sphere with an emissive iris, a slit pupil, and an eyelid that is a joint-posed shell. Scale cues: snow particles, tiny Lantern Watch soldiers on her nose, and `volumetricFog` god rays cutting past her horns.

---

## Supporting cast

- **King Osric III of Calder.** Seen once, in silhouette on a balcony as the lanterns go out. He doesn't come down.
- **The Lantern Watch.** Calder's soldiers. Steel caps, black tabards, and a lantern on every pole. They're a crowd with "Run," "Brace" and "Fall" clips, plus physics bodies when a wall section bursts.
- **The Steamguard.** The dwarven mech legion. Squat two-legged mechs smaller than Old Grudge, marching in step down the Anvilmouth causeway: a crowd on one clip with tiny phase offsets, so the march looks drilled rather than mechanical.
- **The Wardens of the Long Sleep.** Ithrael's elves. Silhouettes on golden branches, perfectly still.
