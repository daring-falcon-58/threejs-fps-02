// Keyboard and mouse, and the pointer lock that turns the mouse into look. Plain browser
// APIs only: the game asks the canvas for pointer lock and reads movementX/Y while it
// holds it. Right mouse is aim (zoom for the DMR); G throws a grenade; B opens the buy
// menu; E plants/defuses; 1-5 buy in the menu.
export const createInput = (canvas, onLockChange) => {
  const keys = new Set();
  const state = { keys, locked: false, firing: false, aiming: false, lookX: 0, lookY: 0 };

  const clearInput = () => {
    keys.clear();
    state.firing = false;
    state.aiming = false;
  };

  const setKey = (event, down) => {
    if (down) keys.add(event.code);
    else keys.delete(event.code);
    if (event.code === 'Space') event.preventDefault();
  };

  const handlers = [
    ['keydown', (event) => setKey(event, true)],
    ['keyup', (event) => setKey(event, false)],
    ['blur', clearInput],
    ['mousemove', (event) => {
      if (state.locked === false) return;
      state.lookX += event.movementX;
      state.lookY += event.movementY;
    }],
    ['mousedown', (event) => {
      if (state.locked === false) return;
      if (event.button === 0) state.firing = true;
      if (event.button === 2) state.aiming = true;
    }],
    ['mouseup', (event) => {
      if (event.button === 0) state.firing = false;
      if (event.button === 2) state.aiming = false;
    }],
    ['contextmenu', (event) => event.preventDefault()],
  ];
  handlers.forEach(([type, handler]) => window.addEventListener(type, handler));
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (state.locked === false) clearInput();
    onLockChange(state.locked);
  });

  const requestLock = () => {
    canvas.requestPointerLock();
  };

  const takeLook = () => {
    const look = { x: state.lookX, y: state.lookY };
    state.lookX = 0;
    state.lookY = 0;
    return look;
  };

  const pressed = (code) => keys.has(code);

  return { state, requestLock, takeLook, pressed };
};
