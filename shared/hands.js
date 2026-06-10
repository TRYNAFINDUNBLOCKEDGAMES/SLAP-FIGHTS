const HAND_REGISTRY = {
  Speedy: {
    name: "Speedy",
    type: "passive",
    speedMultiplier: 1.5,
    jumpMultiplier: 1.0,
    cooldown: 0,
    wallPiercing: false,
    description: "Move 50% faster permanently."
  },
  Jumper: {
    name: "Jumper",
    type: "passive",
    speedMultiplier: 1.0,
    jumpMultiplier: 2.0,
    cooldown: 0,
    wallPiercing: false,
    description: "Jump twice as high permanently."
  },
  Extended: {
    name: "Extended",
    type: "passive",
    speedMultiplier: 1.0,
    jumpMultiplier: 1.0,
    cooldown: 0,
    wallPiercing: true,
    description: "Slap phases through walls with an extended reach dead-zone."
  },
  Diver: {
    name: "Diver",
    type: "active",
    speedMultiplier: 1.0,
    jumpMultiplier: 1.0,
    cooldown: 5000,
    wallPiercing: false,
    description: "Launch skyward, click within 7 seconds to tactical dive-bomb."
  },
  Builder: {
    name: "Builder",
    type: "active",
    speedMultiplier: 1.0,
    jumpMultiplier: 1.0,
    cooldown: 2000,
    wallPiercing: true,
    description: "Spawn up to 6 defensive climbing walls. Can slap through walls."
  },
  Sniper: {
    name: "Sniper",
    type: "active",
    speedMultiplier: 1.0,
    jumpMultiplier: 1.0,
    cooldown: 3000,
    wallPiercing: false,
    description: "Fire perfectly horizontal, dynamic-height projectiles."
  }
};

if (typeof module !== 'undefined') {
  module.exports = HAND_REGISTRY;
}
