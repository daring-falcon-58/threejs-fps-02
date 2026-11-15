// Kestrel Yard: an original dusk rail yard, 52 x 38 m. Two bomb sites — A "Silos" west,
// B "Depot" east — joined by a mid lane and two side lanes, with containers, crates and
// silos for cover. The world owns the colliders, the line-of-sight test, the shared
// box mover (player and bots use the same collision), the waypoint graph the bots
// navigate, and the spawn points.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const WALL_H = 5.2;

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.94,
      metalness: name === 'hairline' || name === 'surface' ? 0.18 : 0.03,
    });
  }
  // Warm rust containers and cool teal containers, so the two lanes read apart.
  const rustMat = new THREE.MeshStandardMaterial({ color: 0x9a4a28, roughness: 0.85, metalness: 0.25 });
  const tealMat = new THREE.MeshStandardMaterial({ color: 0x2e6f66, roughness: 0.85, metalness: 0.25 });
  const siloMat = new THREE.MeshStandardMaterial({ color: 0x6d7680, roughness: 0.6, metalness: 0.55 });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  function cylinder(radius, height, x, z, material, segments = 18) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), material);
    mesh.position.set(x, height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    // Colliders stay boxes: a silo's collider is its square footprint.
    colliders.push(new THREE.Box3(new THREE.Vector3(x - radius, 0, z - radius), new THREE.Vector3(x + radius, height, z + radius)));
    shootables.push(mesh);
    return mesh;
  }

  function flatRing(x, z, radius, color) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.25, radius, 40),
      new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.02, z);
    group.add(ring);
    return ring;
  }

  // ---- Ground and perimeter ----
  box(52.4, 0.4, 38.4, 0, -0.2, 0, materials.ground);
  box(0.4, WALL_H, 38.4, -26.2, WALL_H / 2, 0, materials.surface);
  box(0.4, WALL_H, 38.4, 26.2, WALL_H / 2, 0, materials.surface);
  box(52.4, WALL_H, 0.4, 0, WALL_H / 2, -19.2, materials.surface);
  box(52.4, WALL_H, 0.4, 0, WALL_H / 2, 19.2, materials.surface);
  // Yard markings: faded centre line and site borders, flat on the ground.
  box(0.3, 0.02, 30, 0, 0.01, 0, materials.hairline);
  box(30, 0.02, 0.3, 0, 0.01, 0, materials.hairline);

  // ---- A site "Silos" (west, x -19, z -9) ----
  cylinder(2.4, 7.5, -21, -12, siloMat);
  cylinder(2.4, 6.2, -16.5, -13.5, siloMat);
  box(3.4, 1.1, 1.4, -19.5, 0.55, -5.5, materials.hairline);
  box(1.4, 1.1, 3.2, -23, 0.55, -7, materials.hairline);
  box(2.2, 2.2, 2.2, -15.5, 1.1, -9.5, rustMat);
  flatRing(-19, -9.5, 4.2, 0x3fb8a6);

  // ---- B site "Depot" (east, x 19, z -9) ----
  box(6.2, 2.6, 2.6, 21.5, 1.3, -13.5, tealMat);
  box(6.2, 2.6, 2.6, 21.5, 3.9, -13.5, rustMat);
  box(2.2, 1.1, 2.2, 16.5, 0.55, -6, materials.hairline);
  box(1.4, 1.1, 3.4, 23.5, 0.55, -6.5, materials.hairline);
  box(3.0, 1.1, 1.4, 18.5, 0.55, -13, materials.hairline);
  flatRing(19, -9.5, 4.2, 0x3fb8a6);

  // ---- Mid: container block and catwalk ----
  box(4.4, 2.6, 2.4, -3, 1.3, 1.5, rustMat);
  box(4.4, 2.6, 2.4, 3.4, 1.3, -2.5, tealMat);
  box(2.0, 0.9, 2.0, 0, 0.45, 6.5, materials.hairline);
  box(1.6, 0.9, 1.6, -7.5, 0.45, -2, materials.hairline);
  box(1.6, 0.9, 1.6, 7.5, 0.45, -2, materials.hairline);
  // Catwalk over mid: a low platform bots and the player can climb via the ramp.
  box(8, 0.3, 2.2, 0, 2.6, -7.5, materials.surface);
  box(0.3, 2.6, 2.2, -4.1, 1.3, -7.5, materials.surface);
  box(0.3, 2.6, 2.2, 4.1, 1.3, -7.5, materials.surface);
  box(2.2, 0.3, 3.4, 0, 1.35, -7.5, materials.hairline);

  // ---- T side (south) and CT side (north) cover ----
  box(3.2, 1.1, 1.4, -10, 0.55, 12, materials.hairline);
  box(3.2, 1.1, 1.4, 10, 0.55, 12, materials.hairline);
  box(1.6, 1.1, 1.6, -14, 0.55, 5, rustMat);
  box(1.6, 1.1, 1.6, 14, 0.55, 5, tealMat);
  box(2.6, 2.4, 1.2, -7, 1.2, -13.5, materials.hairline);
  box(2.6, 2.4, 1.2, 7, 1.2, -13.5, materials.hairline);
  box(1.8, 0.9, 1.8, 0, 0.45, -14.5, materials.hairline);

  // ---- Distant silhouettes outside the walls, for depth at dusk ----
  const ghost = new THREE.MeshStandardMaterial({ color: 0x1c2129, roughness: 1, metalness: 0 });
  const crane = new THREE.Mesh(new THREE.BoxGeometry(1.2, 16, 1.2), ghost);
  crane.position.set(-34, 8, -8);
  group.add(crane);
  const craneArm = new THREE.Mesh(new THREE.BoxGeometry(14, 1, 1), ghost);
  craneArm.position.set(-28, 15, -8);
  group.add(craneArm);
  for (const [x, z, r, h] of [[34, -12, 3, 10], [36, 4, 2.4, 8], [-34, 10, 2.6, 9]]) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 14), ghost);
    s.position.set(x, h / 2, z);
    group.add(s);
  }

  // ---- Light: low amber sun from the west, cool fill, dusk sky ----
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 78);
  const sky = new THREE.HemisphereLight(new THREE.Color(0x8a97a8), new THREE.Color(0x1a1512), 1.35);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color(0xffb45e), 2.8);
  sun.position.set(-24, 16, 10);
  sun.target.position.set(4, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(0x5f7ea6), 0.75);
  fill.position.set(14, 12, 14);
  scene.add(fill);

  // ---- Bomb sites, spawns, waypoints ----
  const sites = [
    { id: 'A', name: 'Silos', center: new THREE.Vector3(-19, 0, -9.5), radius: 4.2 },
    { id: 'B', name: 'Depot', center: new THREE.Vector3(19, 0, -9.5), radius: 4.2 },
  ];
  const spawns = {
    vipers: [
      new THREE.Vector3(-4, 0, 16), new THREE.Vector3(0, 0, 17), new THREE.Vector3(4, 0, 16),
      new THREE.Vector3(-8, 0, 14), new THREE.Vector3(8, 0, 14),
    ],
    jackals: [
      new THREE.Vector3(-4, 0, -16), new THREE.Vector3(0, 0, -17), new THREE.Vector3(4, 0, -16),
      new THREE.Vector3(-8, 0, -14), new THREE.Vector3(8, 0, -14),
    ],
  };

  // Waypoint graph: nodes in open ground, edges between neighbours a bot can walk.
  const N = (x, z) => new THREE.Vector3(x, 0, z);
  const nodes = {
    tSpawn: N(0, 15), tWest: N(-12, 12), tEast: N(12, 12),
    tMid: N(0, 8), midWest: N(-8, 1), mid: N(0, 0), midEast: N(8, -1),
    midTop: N(0, -8), aLane1: N(-18, 8), aLane2: N(-18, 0), aSite: N(-19, -9.5),
    aBack: N(-22.5, -14.5), aApproach: N(-10, -11), bLane1: N(18, 8), bLane2: N(18, 0),
    bSite: N(19, -9.5), bBack: N(22.5, -14.5), bApproach: N(10, -11),
    ctSpawn: N(0, -15), ctWest: N(-10, -15), ctEast: N(10, -15), ctMid: N(-4, -13),
  };
  const edges = {
    tSpawn: ['tWest', 'tEast', 'tMid'], tWest: ['tSpawn', 'aLane1', 'tMid'],
    tEast: ['tSpawn', 'bLane1', 'tMid'], tMid: ['tSpawn', 'midWest', 'midEast', 'mid', 'tWest', 'tEast'],
    midWest: ['tMid', 'mid', 'aLane2'], mid: ['midWest', 'midEast', 'midTop', 'tMid'],
    midEast: ['mid', 'tMid', 'bLane2'], midTop: ['mid', 'aApproach', 'bApproach', 'ctMid'],
    aLane1: ['tWest', 'aLane2'], aLane2: ['aLane1', 'aSite', 'midWest'],
    aSite: ['aLane2', 'aBack', 'aApproach'], aBack: ['aSite', 'ctWest'],
    aApproach: ['aSite', 'midTop', 'ctWest'], bLane1: ['tEast', 'bLane2'],
    bLane2: ['bLane1', 'bSite', 'midEast'], bSite: ['bLane2', 'bBack', 'bApproach'],
    bBack: ['bSite', 'ctEast'], bApproach: ['bSite', 'midTop', 'ctEast'],
    ctSpawn: ['ctWest', 'ctEast', 'ctMid'], ctWest: ['ctSpawn', 'aBack', 'aApproach'],
    ctEast: ['ctSpawn', 'bBack', 'bApproach'], ctMid: ['ctSpawn', 'midTop', 'ctWest', 'ctEast'],
  };

  function route(fromNode, toNode) {
    // Breadth-first search over the waypoint graph; returns node names from -> to.
    if (fromNode === toNode) return [fromNode];
    const prev = { [fromNode]: null };
    const queue = [fromNode];
    while (queue.length) {
      const current = queue.shift();
      for (const next of edges[current] || []) {
        if (!(next in prev)) {
          prev[next] = current;
          if (next === toNode) {
            const path = [next];
            let node = current;
            while (node) { path.unshift(node); node = prev[node]; }
            return path;
          }
          queue.push(next);
        }
      }
    }
    return [fromNode, toNode];
  }

  function nearestNode(position) {
    let best = 'tSpawn';
    let bestDist = Infinity;
    for (const [name, node] of Object.entries(nodes)) {
      const d = (node.x - position.x) ** 2 + (node.z - position.z) ** 2;
      if (d < bestDist) { bestDist = d; best = name; }
    }
    return best;
  }

  // ---- Collision: axis-separated box mover, shared by the player and the bots ----
  const probe = new THREE.Box3();
  function overlaps(x, y, z, radius, height, lift) {
    probe.min.set(x - radius, y + lift, z - radius);
    probe.max.set(x + radius, y + height - lift, z + radius);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  // Moves a body (position Vector3, velocity Vector3) one step; resolves x, z then y.
  function moveBody(position, velocity, dt, radius, height, gravity) {
    const nextX = position.x + velocity.x * dt;
    if (!overlaps(nextX, position.y, position.z, radius, height, 0.04)) position.x = nextX;
    else velocity.x = 0;
    const nextZ = position.z + velocity.z * dt;
    if (!overlaps(position.x, position.y, nextZ, radius, height, 0.04)) position.z = nextZ;
    else velocity.z = 0;
    position.y += velocity.y * dt;
    let onGround = false;
    const hit = overlaps(position.x, position.y, position.z, radius, height, 0);
    if (hit && velocity.y <= 0) {
      position.y = hit.max.y;
      velocity.y = 0;
      onGround = true;
    } else if (hit) {
      position.y = hit.min.y - height;
      velocity.y = 0;
    }
    if (position.y < 0) {
      position.y = 0;
      velocity.y = 0;
      onGround = true;
    }
    if (gravity !== 0) velocity.y -= gravity * dt;
    return onGround;
  }

  // Segment vs AABB slab test: true when the segment is blocked by any collider.
  function segmentBlocked(ax, ay, az, bx, by, bz) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    for (const c of colliders) {
      let tmin = 0;
      let tmax = 1;
      let ok = true;
      for (const [o, d, mn, mx] of [[ax, dx, c.min.x, c.max.x], [ay, dy, c.min.y, c.max.y], [az, dz, c.min.z, c.max.z]]) {
        if (Math.abs(d) < 1e-9) {
          if (o < mn || o > mx) { ok = false; break; }
        } else {
          let t1 = (mn - o) / d;
          let t2 = (mx - o) / d;
          if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
          tmin = Math.max(tmin, t1);
          tmax = Math.min(tmax, t2);
          if (tmin > tmax) { ok = false; break; }
        }
      }
      if (ok) return true;
    }
    return false;
  }

  return { colliders, shootables, group, sites, spawns, nodes, edges, route, nearestNode, moveBody, segmentBlocked, overlaps };
}
