import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useSocket } from "../contexts/SocketContext";
import { Layout, Card, Header, Button, Select, Alert, Modal } from "./ui";
import "./SeaBattle2.css";

const BOARD_SIZE = 10;

const makeEmptyGrid = (fillValue = null) =>
  Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => fillValue));

const SHIP_SPECS = [
  ...Array.from({ length: 4 }, (_, i) => ({ id: `s1-${i + 1}`, length: 1 })),
  ...Array.from({ length: 3 }, (_, i) => ({ id: `s2-${i + 1}`, length: 2 })),
  ...Array.from({ length: 2 }, (_, i) => ({ id: `s3-${i + 1}`, length: 3 })),
  { id: "s4-1", length: 4 },
];

const DEFAULT_AMMO = {
  caza: 2,
  torpedo: 2,
  antiaerea: 2,
  bombardero: 1,
  mina: 2,
  submarino: 1,
};

const clampCellsToBoard = (cells) =>
  cells.filter(({ r, c }) => r >= 0 && r < BOARD_SIZE && c >= 0 && c < BOARD_SIZE);

const getCellsForPlacement = (r, c, length, orientation) => {
  const cells = [];
  for (let i = 0; i < length; i += 1) {
    cells.push({ r: orientation === "h" ? r : r + i, c: orientation === "h" ? c + i : c });
  }
  // Out of bounds check early
  for (const cell of cells) {
    if (cell.r < 0 || cell.r >= BOARD_SIZE || cell.c < 0 || cell.c >= BOARD_SIZE) return null;
  }
  return cells;
};

const deepCopyGrid = (grid) => grid.map((row) => row.slice());

const removeShipFromGrid = (grid, shipId) => {
  const next = deepCopyGrid(grid);
  for (let r = 0; r < BOARD_SIZE; r += 1) {
    for (let c = 0; c < BOARD_SIZE; c += 1) {
      if (next[r][c] === shipId) next[r][c] = null;
    }
  }
  return next;
};

const canPlace = (grid, shipId, cells) => {
  for (const { r, c } of cells) {
    const occupant = grid[r][c];
    if (occupant && occupant !== shipId) return false;
  }
  return true;
};

const placeShipOnGrid = (grid, shipId, cells) => {
  const next = deepCopyGrid(grid);
  for (const { r, c } of cells) next[r][c] = shipId;
  return next;
};

const computeShipCells = (grid, shipId) => {
  const cells = [];
  for (let r = 0; r < BOARD_SIZE; r += 1) {
    for (let c = 0; c < BOARD_SIZE; c += 1) {
      if (grid[r][c] === shipId) cells.push({ r, c });
    }
  }
  return cells;
};

const cellsKey = ({ r, c }) => `${r},${c}`;

const isAllShipsSunk = (shipList, hitsSet) => {
  for (const ship of shipList) {
    if (!ship.placedCells || ship.placedCells.length === 0) return false;
    for (const cell of ship.placedCells) {
      if (!hitsSet.has(cellsKey(cell))) return false;
    }
  }
  return true;
};

const WEAPONS = [
  { value: "shot", label: "Disparo", icon: "🎯", needsAmmo: false },
  { value: "caza", label: "Caza (sonar)", icon: "🛰️", needsAmmo: true },
  { value: "torpedo", label: "Torpedo", icon: "🧨", needsAmmo: true },
  { value: "antiaerea", label: "Arma antiaérea", icon: "🛡️", needsAmmo: true },
  { value: "bombardero", label: "Bombardero", icon: "💣", needsAmmo: true },
  { value: "mina", label: "Mina", icon: "🧱", needsAmmo: true },
  { value: "submarino", label: "Submarino", icon: "🤿", needsAmmo: true },
];

const weaponTargetCells = (weapon, r, c, orientation) => {
  switch (weapon) {
    case "shot":
      return [{ r, c }];
    case "caza": {
      // 3x3 scan (no damage)
      const cells = [];
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          cells.push({ r: r + dr, c: c + dc });
        }
      }
      return clampCellsToBoard(cells);
    }
    case "torpedo": {
      // Line of 4 cells
      const cells = [];
      for (let i = 0; i < 4; i += 1) {
        cells.push({ r: orientation === "h" ? r : r + i, c: orientation === "h" ? c + i : c });
      }
      return clampCellsToBoard(cells);
    }
    case "antiaerea": {
      // Plus shape
      return clampCellsToBoard([
        { r, c },
        { r: r - 1, c },
        { r: r + 1, c },
        { r, c: c - 1 },
        { r, c: c + 1 },
      ]);
    }
    case "bombardero": {
      // 3x3 damage
      const cells = [];
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          cells.push({ r: r + dr, c: c + dc });
        }
      }
      return clampCellsToBoard(cells);
    }
    case "mina": {
      // 2x2 damage anchored at target
      return clampCellsToBoard([
        { r, c },
        { r: r + 1, c },
        { r, c: c + 1 },
        { r: r + 1, c: c + 1 },
      ]);
    }
    case "submarino": {
      // Line of 5 cells
      const cells = [];
      for (let i = 0; i < 5; i += 1) {
        cells.push({ r: orientation === "h" ? r : r + i, c: orientation === "h" ? c + i : c });
      }
      return clampCellsToBoard(cells);
    }
    default:
      return [{ r, c }];
  }
};

const randomInt = (max) => Math.floor(Math.random() * max);

const tryRandomPlacement = (ships) => {
  let grid = makeEmptyGrid(null);
  const placedShips = ships.map((s) => ({ ...s, orientation: "h", placedCells: [] }));

  for (const ship of placedShips) {
    let placed = false;
    let tries = 0;
    while (!placed && tries < 500) {
      tries += 1;
      const orientation = Math.random() < 0.5 ? "h" : "v";
      const r = randomInt(BOARD_SIZE);
      const c = randomInt(BOARD_SIZE);
      const cells = getCellsForPlacement(r, c, ship.length, orientation);
      if (!cells) continue;
      if (!canPlace(grid, ship.id, cells)) continue;
      grid = placeShipOnGrid(grid, ship.id, cells);
      ship.orientation = orientation;
      ship.placedCells = cells;
      placed = true;
    }
    if (!placed) return null;
  }

  return { grid, ships: placedShips };
};

const buildShips = () =>
  SHIP_SPECS.map((s) => ({
    id: s.id,
    length: s.length,
    orientation: "h",
    placedCells: [],
  }));

const makeUnknownShotsGrid = () => makeEmptyGrid("unknown");

function SeaBattle2() {
  const navigate = useNavigate();
  const location = useLocation();
  const socket = useSocket();

  const { playerName, roomCode, players = [] } = location.state || {};
  const isMultiplayer = Boolean(playerName && roomCode);

  const [phase, setPhase] = useState("placement");
  const [advanced, setAdvanced] = useState(false);
  const [weapon, setWeapon] = useState("shot");
  const [weaponOrientation, setWeaponOrientation] = useState("h");
  const [ammo, setAmmo] = useState(DEFAULT_AMMO);

  const [playerShips, setPlayerShips] = useState(() => buildShips());
  const [enemyShips, setEnemyShips] = useState(() => buildShips());

  const [playerGrid, setPlayerGrid] = useState(() => makeEmptyGrid(null));
  const [enemyGrid, setEnemyGrid] = useState(() => makeEmptyGrid(null));

  const [playerShots, setPlayerShots] = useState(() => makeUnknownShotsGrid());
  const [enemyShots, setEnemyShots] = useState(() => makeUnknownShotsGrid());

  const [playerHits, setPlayerHits] = useState(() => new Set()); // hits on enemy
  const [enemyHits, setEnemyHits] = useState(() => new Set()); // hits on player

  const [turn, setTurn] = useState("player");
  const [alert, setAlert] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);

  // Multiplayer state
  const [mp, setMp] = useState({
    status: "idle", // idle | ready-submitted
    youAreIndex: null,
    turnIndex: 0,
    winnerIndex: null,
  });

  const placedCount = useMemo(
    () => playerShips.filter((s) => s.placedCells && s.placedCells.length > 0).length,
    [playerShips]
  );

  const totalShips = playerShips.length;

  const placementLocked = isMultiplayer && mp.status === "ready-submitted";

  const resetAll = useCallback(() => {
    setPhase("placement");
    setAdvanced(false);
    setWeapon("shot");
    setWeaponOrientation("h");
    setAmmo(DEFAULT_AMMO);

    setPlayerShips(buildShips());
    setEnemyShips(buildShips());

    setPlayerGrid(makeEmptyGrid(null));
    setEnemyGrid(makeEmptyGrid(null));

    setPlayerShots(makeUnknownShotsGrid());
    setEnemyShots(makeUnknownShotsGrid());

    setPlayerHits(new Set());
    setEnemyHits(new Set());

    setTurn("player");
    setAlert(null);

    setMp({ status: "idle", youAreIndex: null, turnIndex: 0, winnerIndex: null });
  }, []);

  const randomizePlayer = useCallback(() => {
    const attempt = tryRandomPlacement(buildShips());
    if (!attempt) {
      setAlert({ type: "error", title: "Error", message: "No se pudo generar una configuración aleatoria." });
      return;
    }
    setPlayerGrid(attempt.grid);
    setPlayerShips(attempt.ships);
    setAlert({ type: "success", title: "Listo", message: "Barcos colocados aleatoriamente." });
  }, []);

  const startBattle = useCallback(() => {
    if (placedCount !== totalShips) {
      setAlert({
        type: "warning",
        title: "Faltan barcos",
        message: `Coloca todos los barcos (${placedCount}/${totalShips}).`,
      });
      return;
    }

    if (isMultiplayer) {
      socket.emit("sea_battle_submit_fleet", {
        roomCode: roomCode.trim().toLowerCase(),
        grid: playerGrid,
        ships: playerShips,
        advanced,
      });
      setMp((prev) => ({ ...prev, status: "ready-submitted" }));
      setAlert({ type: "success", title: "Listo", message: "Flota enviada. Esperando al oponente..." });
      return;
    }

    const enemyAttempt = tryRandomPlacement(buildShips());
    if (!enemyAttempt) {
      setAlert({ type: "error", title: "Error", message: "No se pudo colocar la flota enemiga." });
      return;
    }

    setEnemyGrid(enemyAttempt.grid);
    setEnemyShips(enemyAttempt.ships);

    setPhase("battle");
    setTurn("player");
    setAlert({ type: "success", title: "Batalla", message: "¡Comienza la batalla!" });
  }, [advanced, isMultiplayer, placedCount, playerGrid, playerShips, roomCode, socket, totalShips]);

  const updateShipPlacedCellsFromGrid = useCallback((grid, ships) => {
    return ships.map((ship) => ({
      ...ship,
      placedCells: computeShipCells(grid, ship.id),
    }));
  }, []);

  const attemptPlaceShip = useCallback(
    (shipId, targetR, targetC) => {
      const ship = playerShips.find((s) => s.id === shipId);
      if (!ship) return;

      const cells = getCellsForPlacement(targetR, targetC, ship.length, ship.orientation);
      if (!cells) {
        setAlert({ type: "warning", title: "Inválido", message: "No cabe en el tablero." });
        return;
      }

      // Remove current placement (if any) before checking overlap.
      let nextGrid = removeShipFromGrid(playerGrid, shipId);
      if (!canPlace(nextGrid, shipId, cells)) {
        setAlert({ type: "warning", title: "Inválido", message: "Hay un barco ocupando ese lugar." });
        return;
      }

      nextGrid = placeShipOnGrid(nextGrid, shipId, cells);
      setPlayerGrid(nextGrid);
      setPlayerShips((prev) => updateShipPlacedCellsFromGrid(nextGrid, prev));
      setAlert(null);
    },
    [playerGrid, playerShips, updateShipPlacedCellsFromGrid]
  );

  const toggleShipOrientation = useCallback(
    (shipId) => {
      setPlayerShips((prev) =>
        prev.map((s) =>
          s.id === shipId ? { ...s, orientation: s.orientation === "h" ? "v" : "h" } : s
        )
      );
    },
    [setPlayerShips]
  );

  const attemptRotatePlacedShip = useCallback(
    (shipId) => {
      const ship = playerShips.find((s) => s.id === shipId);
      if (!ship || !ship.placedCells || ship.placedCells.length === 0) return;

      // Use the top-left most cell as anchor.
      const anchor = ship.placedCells.reduce(
        (acc, cell) => {
          if (cell.r < acc.r) return cell;
          if (cell.r === acc.r && cell.c < acc.c) return cell;
          return acc;
        },
        ship.placedCells[0]
      );

      const nextOrientation = ship.orientation === "h" ? "v" : "h";
      const nextCells = getCellsForPlacement(anchor.r, anchor.c, ship.length, nextOrientation);
      if (!nextCells) return;

      let nextGrid = removeShipFromGrid(playerGrid, shipId);
      if (!canPlace(nextGrid, shipId, nextCells)) return;

      nextGrid = placeShipOnGrid(nextGrid, shipId, nextCells);
      setPlayerGrid(nextGrid);
      setPlayerShips((prev) =>
        updateShipPlacedCellsFromGrid(nextGrid, prev).map((s) =>
          s.id === shipId ? { ...s, orientation: nextOrientation } : s
        )
      );
    },
    [playerGrid, playerShips, updateShipPlacedCellsFromGrid]
  );

  const getPlacedShipAnchorSet = useMemo(() => {
    const anchors = new Set();
    for (const ship of playerShips) {
      if (!ship.placedCells || ship.placedCells.length === 0) continue;
      const anchor = ship.placedCells.reduce(
        (acc, cell) => {
          if (cell.r < acc.r) return cell;
          if (cell.r === acc.r && cell.c < acc.c) return cell;
          return acc;
        },
        ship.placedCells[0]
      );
      anchors.add(`${ship.id}:${anchor.r},${anchor.c}`);
    }
    return anchors;
  }, [playerShips]);

  const onDragStartShip = useCallback((e, shipId) => {
    e.dataTransfer.setData("application/json", JSON.stringify({ shipId }));
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const onDropCell = useCallback(
    (e, r, c) => {
      e.preventDefault();
      if (phase !== "placement") return;
      if (placementLocked) return;

      const raw = e.dataTransfer.getData("application/json");
      if (!raw) return;

      try {
        const data = JSON.parse(raw);
        if (!data.shipId) return;
        attemptPlaceShip(data.shipId, r, c);
      } catch {
        // ignore
      }
    },
    [attemptPlaceShip, phase, placementLocked]
  );

  const onDragOverCell = useCallback((e) => {
    if (phase !== "placement") return;
    if (placementLocked) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, [phase, placementLocked]);

  const consumeAmmo = useCallback(
    (weaponType) => {
      if (weaponType === "shot") return true;
      if (!advanced) return false;
      const current = ammo[weaponType];
      if (!current || current <= 0) return false;
      setAmmo((prev) => ({ ...prev, [weaponType]: prev[weaponType] - 1 }));
      return true;
    },
    [advanced, ammo]
  );

  const applyAttackToEnemy = useCallback(
    (targetCells, weaponType) => {
      let anyHit = false;
      let nextShots = deepCopyGrid(playerShots);
      const nextHits = new Set(playerHits);

      for (const cell of targetCells) {
        const already = nextShots[cell.r][cell.c];
        if (already === "hit" || already === "miss") continue;

        const hasShip = Boolean(enemyGrid[cell.r][cell.c]);

        if (weaponType === "caza") {
          nextShots[cell.r][cell.c] = hasShip ? "scan-ship" : "scan-water";
          continue;
        }

        if (hasShip) {
          nextShots[cell.r][cell.c] = "hit";
          nextHits.add(cellsKey(cell));
          anyHit = true;
        } else {
          nextShots[cell.r][cell.c] = "miss";
        }
      }

      setPlayerShots(nextShots);
      setPlayerHits(nextHits);

      const enemySunk = isAllShipsSunk(enemyShips, nextHits);
      if (enemySunk) {
        setPhase("gameover");
        setAlert({ type: "success", title: "¡Ganaste!", message: "Hundiste toda la flota enemiga." });
        return { anyHit, gameOver: true };
      }

      return { anyHit, gameOver: false };
    },
    [enemyGrid, enemyShips, playerHits, playerShots]
  );

  const applyAttackToPlayer = useCallback(
    (r, c) => {
      const current = enemyShots[r][c];
      if (current === "hit" || current === "miss") return { applied: false, anyHit: false, gameOver: false };

      const hasShip = Boolean(playerGrid[r][c]);

      const nextShots = deepCopyGrid(enemyShots);
      const nextHits = new Set(enemyHits);

      if (hasShip) {
        nextShots[r][c] = "hit";
        nextHits.add(`${r},${c}`);
      } else {
        nextShots[r][c] = "miss";
      }

      setEnemyShots(nextShots);
      setEnemyHits(nextHits);

      const playerSunk = isAllShipsSunk(playerShips, nextHits);
      if (playerSunk) {
        setPhase("gameover");
        setAlert({ type: "error", title: "Perdiste", message: "La IA hundió toda tu flota." });
        return { applied: true, anyHit: hasShip, gameOver: true };
      }

      return { applied: true, anyHit: hasShip, gameOver: false };
    },
    [enemyHits, enemyShots, playerGrid, playerShips]
  );

  const aiTurn = useCallback(() => {
    if (phase !== "battle") return;
    if (turn !== "ai") return;

    // random untried cell
    const candidates = [];
    for (let r = 0; r < BOARD_SIZE; r += 1) {
      for (let c = 0; c < BOARD_SIZE; c += 1) {
        const state = enemyShots[r][c];
        if (state !== "hit" && state !== "miss") candidates.push({ r, c });
      }
    }
    if (candidates.length === 0) return;

    const pick = candidates[randomInt(candidates.length)];
    const res = applyAttackToPlayer(pick.r, pick.c);
    if (res.gameOver) return;

    // Simple rule: AI repeats if hit.
    if (res.anyHit) {
      setTimeout(() => aiTurn(), 500);
    } else {
      setTurn("player");
    }
  }, [applyAttackToPlayer, enemyShots, phase, turn]);

  useEffect(() => {
    if (!isMultiplayer && turn === "ai" && phase === "battle") {
      const t = setTimeout(() => aiTurn(), 450);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [aiTurn, isMultiplayer, phase, turn]);

  const playerAttack = useCallback(
    (r, c) => {
      if (phase !== "battle") return;
      if (turn !== "player") return;

      if (isMultiplayer) {
        socket.emit("sea_battle_attack", {
          roomCode: roomCode.trim().toLowerCase(),
          r,
          c,
          weapon,
          orientation: weaponOrientation,
        });
        return;
      }

      const weaponMeta = WEAPONS.find((w) => w.value === weapon);
      if (weaponMeta?.needsAmmo) {
        const ok = consumeAmmo(weapon);
        if (!ok) {
          setAlert({ type: "warning", title: "Sin munición", message: "No te queda munición para ese arma." });
          return;
        }
      }

      const targets = weaponTargetCells(weapon, r, c, weaponOrientation);
      const res = applyAttackToEnemy(targets, weapon);
      if (res.gameOver) return;

      // Keep turn if hit and weapon is not sonar.
      if (weapon !== "caza" && res.anyHit) {
        setTurn("player");
      } else {
        setTurn("ai");
      }
    },
    [applyAttackToEnemy, consumeAmmo, isMultiplayer, phase, roomCode, socket, turn, weapon, weaponOrientation]
  );

  // Multiplayer: keep state in sync
  useEffect(() => {
    if (!isMultiplayer) return;

    const handleState = (data) => {
      if (!data) return;

      if (typeof data.phase === "string") setPhase(data.phase);
      if (typeof data.turnIndex === "number") {
        setMp((prev) => ({ ...prev, turnIndex: data.turnIndex }));
      }
      if (typeof data.youAreIndex === "number") {
        setMp((prev) => ({ ...prev, youAreIndex: data.youAreIndex }));
      }
      if (typeof data.winnerIndex === "number" || data.winnerIndex === null) {
        setMp((prev) => ({ ...prev, winnerIndex: data.winnerIndex ?? null }));
      }

      if (data.yourGrid) setPlayerGrid(data.yourGrid);
      if (data.yourShips) setPlayerShips(data.yourShips);

      if (data.yourShotsOnEnemy) setPlayerShots(data.yourShotsOnEnemy);
      if (data.enemyShotsOnYou) setEnemyShots(data.enemyShotsOnYou);

      if (data.ammo) setAmmo(data.ammo);
      if (typeof data.advanced === "boolean") setAdvanced(data.advanced);

      // derive turn based on index
      if (typeof data.youAreIndex === "number" && typeof data.turnIndex === "number") {
        setTurn(data.turnIndex === data.youAreIndex ? "player" : "ai");
      }
    };

    const handleError = (data) => {
      setAlert({ type: "error", title: "Error", message: data?.message || "Acción inválida." });
    };

    socket.on("sea_battle_state", handleState);
    socket.on("sea_battle_error", handleError);

    socket.emit("sea_battle_join", { roomCode: roomCode.trim().toLowerCase() });

    return () => {
      socket.off("sea_battle_state", handleState);
      socket.off("sea_battle_error", handleError);
    };
  }, [isMultiplayer, roomCode, socket]);

  const renderGrid = (kind) => {
    const isPlayer = kind === "player";
    const grid = isPlayer ? playerGrid : enemyGrid;
    const shots = isPlayer ? enemyShots : playerShots;

    return (
      <div className={`sea2-board sea2-board--${kind}`}>
        <div className="sea2-board__title">
          {isPlayer ? "Tu tablero" : "Enemigo"}
          {phase === "battle" && !isPlayer && (
            <span className="sea2-board__subtitle">
              Turno: {turn === "player" ? "Tú" : (isMultiplayer ? "Oponente" : "IA")}
            </span>
          )}
        </div>

        <div className="sea2-grid" role="grid" aria-label={isPlayer ? "Tablero del jugador" : "Tablero del enemigo"}>
          {Array.from({ length: BOARD_SIZE }).map((_, r) =>
            Array.from({ length: BOARD_SIZE }).map((__, c) => {
              const shipId = grid[r][c];
              const shotState = shots[r][c];

              const isShipVisible = isPlayer && Boolean(shipId);
              const isHit = shotState === "hit";
              const isMiss = shotState === "miss";
              const isScanShip = shotState === "scan-ship";
              const isScanWater = shotState === "scan-water";

              const isAnchor = isPlayer && Boolean(shipId) && getPlacedShipAnchorSet.has(`${shipId}:${r},${c}`);

              const className = [
                "sea2-cell",
                isShipVisible && "sea2-cell--ship",
                isHit && "sea2-cell--hit",
                isMiss && "sea2-cell--miss",
                isScanShip && "sea2-cell--scan-ship",
                isScanWater && "sea2-cell--scan-water",
                !isPlayer && phase === "battle" && turn === "player" && "sea2-cell--targetable",
              ]
                .filter(Boolean)
                .join(" ");

              const onClick = !isPlayer ? () => playerAttack(r, c) : undefined;
              const onDrop = isPlayer ? (e) => onDropCell(e, r, c) : undefined;
              const onDragOver = isPlayer ? onDragOverCell : undefined;

              const onContextMenu =
                isPlayer && phase === "placement" && !placementLocked && shipId
                  ? (e) => {
                      e.preventDefault();
                      attemptRotatePlacedShip(shipId);
                    }
                  : undefined;

              return (
                <div
                  key={`${kind}-${r}-${c}`}
                  className={className}
                  role="gridcell"
                  onClick={onClick}
                  onDrop={onDrop}
                  onDragOver={onDragOver}
                  onContextMenu={onContextMenu}
                  aria-label={`${r + 1},${c + 1}`}
                >
                  {isAnchor && phase === "placement" && (
                    <div
                      className="sea2-cell__anchor"
                      draggable
                      onDragStart={(e) => onDragStartShip(e, shipId)}
                      title="Arrastra para mover. Click derecho para rotar."
                    />
                  )}
                  {!isPlayer && isHit && <span className="sea2-cell__mark">✕</span>}
                  {!isPlayer && isMiss && <span className="sea2-cell__mark">•</span>}
                  {!isPlayer && isScanShip && <span className="sea2-cell__mark">≋</span>}
                  {!isPlayer && isScanWater && <span className="sea2-cell__mark">~</span>}
                  {isPlayer && isHit && <span className="sea2-cell__mark">✕</span>}
                  {isPlayer && isMiss && <span className="sea2-cell__mark">•</span>}
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  };

  const weaponOptions = useMemo(() => {
    if (!advanced) return [{ value: "shot", label: "Disparo" }];

    return WEAPONS.map((w) => {
      const suffix = w.needsAmmo ? ` (${ammo[w.value] ?? 0})` : "";
      return { value: w.value, label: `${w.icon} ${w.label}${suffix}` };
    });
  }, [advanced, ammo]);

  return (
    <Layout variant="gaming">
      <Card size="extra-large" variant="glass">
        <Header
          title="Sea Battle 2"
          subtitle={
            isMultiplayer
              ? `Sala: ${roomCode} · ${players.map((p) => p.name).filter(Boolean).join(" vs ") || "2 jugadores"}`
              : "Tablero 10x10 · Arrastra, rota y combate"
          }
          icon="🚢"
          variant="gaming"
          size="large"
        >
          <Button variant="minimal" size="small" icon="←" onClick={() => navigate("/")}>Volver</Button>
        </Header>

        {alert && (
          <div className="sea2-alert">
            <Alert variant={alert.type} title={alert.title} dismissible onDismiss={() => setAlert(null)}>
              {alert.message}
            </Alert>
          </div>
        )}

        <div className="sea2-toolbar">
          <div className="sea2-toolbar__left">
            <Button variant="secondary" size="small" icon="🎲" onClick={randomizePlayer} disabled={phase !== "placement" || placementLocked}>
              Aleatorio
            </Button>
            <Button variant="secondary" size="small" icon="🔄" onClick={resetAll}>
              Reiniciar
            </Button>
            <Button variant="minimal" size="small" icon="❔" onClick={() => setHelpOpen(true)}>
              Ayuda
            </Button>
          </div>

          <div className="sea2-toolbar__right">
            <label className="sea2-toggle">
              <input
                type="checkbox"
                checked={advanced}
                disabled={phase !== "placement" && phase !== "battle"}
                onChange={(e) => {
                  const enabled = e.target.checked;
                  setAdvanced(enabled);
                  setWeapon("shot");
                  setAmmo(DEFAULT_AMMO);
                }}
              />
              <span>Modo avanzado</span>
            </label>

            {phase === "battle" && (
              <>
                <Select
                  label="Arma"
                  value={weapon}
                  onChange={(e) => setWeapon(e.target.value)}
                  variant="glass"
                  size="small"
                >
                  {weaponOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </Select>

                <Button
                  variant="secondary"
                  size="small"
                  icon={weaponOrientation === "h" ? "↔" : "↕"}
                  onClick={() => setWeaponOrientation((o) => (o === "h" ? "v" : "h"))}
                  disabled={!advanced || (weapon !== "torpedo" && weapon !== "submarino")}
                  title="Orientación para torpedo/submarino"
                >
                  {weaponOrientation === "h" ? "Horizontal" : "Vertical"}
                </Button>
              </>
            )}

            {phase === "placement" && (
              <Button variant="primary" size="small" icon="⚔️" onClick={startBattle} disabled={placementLocked}>
                {isMultiplayer ? (mp.status === "ready-submitted" ? "Listo" : "Listo") : "Empezar"}
              </Button>
            )}
          </div>
        </div>

        {phase === "placement" && (
          <div className="sea2-placement">
            <div className="sea2-placement__dock">
              <div className="sea2-dock__title">Barcos (click para rotar) · {placedCount}/{totalShips} colocados</div>
              <div className="sea2-dock">
                {playerShips.map((ship) => {
                  const placed = ship.placedCells && ship.placedCells.length > 0;
                  return (
                    <div key={ship.id} className={`sea2-ship ${placed ? "sea2-ship--placed" : ""}`}>
                      <div
                        className={`sea2-ship__piece sea2-ship__piece--${ship.orientation}`}
                        style={{
                          gridTemplateColumns: ship.orientation === "h" ? `repeat(${ship.length}, 1fr)` : "repeat(1, 1fr)",
                          gridTemplateRows: ship.orientation === "v" ? `repeat(${ship.length}, 1fr)` : "repeat(1, 1fr)",
                        }}
                        draggable={!placementLocked}
                        onDragStart={placementLocked ? undefined : (e) => onDragStartShip(e, ship.id)}
                        onClick={placementLocked ? undefined : () => toggleShipOrientation(ship.id)}
                        title={placed ? "Ya colocado (puedes volver a arrastrar)" : "Arrastra al tablero"}
                      >
                        {Array.from({ length: ship.length }).map((_, i) => (
                          <div key={i} className="sea2-ship__cell" />
                        ))}
                      </div>
                      <div className="sea2-ship__meta">
                        <div className="sea2-ship__name">{ship.length}×1</div>
                        <div className="sea2-ship__status">{placed ? "Colocado" : "Sin colocar"}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="sea2-placement__hint">
                - Arrastra barcos al tablero.
                <br />- Click sobre un barco del muelle para rotarlo.
                <br />- Click derecho sobre un barco colocado para rotarlo.
              </div>
            </div>

            <div className="sea2-placement__board">{renderGrid("player")}</div>
          </div>
        )}

        {phase !== "placement" && (
          <div className="sea2-boards">{renderGrid("player")}{renderGrid("enemy")}</div>
        )}

        <Modal isOpen={helpOpen} onClose={() => setHelpOpen(false)} title="Controles Sea Battle 2" variant="default">
          <div className="sea2-help">
            <div className="sea2-help__section">
              <strong>Colocación</strong>
              <ul>
                <li>Arrastra los barcos al tablero 10x10.</li>
                <li>Click en un barco del muelle para rotar.</li>
                <li>Click derecho en un barco colocado para rotar.</li>
                <li>Botón “Aleatorio” coloca toda la flota automáticamente.</li>
              </ul>
            </div>
            <div className="sea2-help__section">
              <strong>Combate</strong>
              <ul>
                <li>Haz click en el tablero enemigo para atacar.</li>
                <li>Si aciertas, repites turno (sonar no cuenta como acierto).</li>
              </ul>
            </div>
            <div className="sea2-help__section">
              <strong>Modo avanzado</strong>
              <ul>
                <li><em>Caza</em>: escanea 3x3 (no hace daño).</li>
                <li><em>Torpedo</em>: línea de 4 (↔/↕).</li>
                <li><em>Antiaérea</em>: patrón “+”.</li>
                <li><em>Bombardero</em>: 3x3 con daño.</li>
                <li><em>Mina</em>: 2x2 con daño.</li>
                <li><em>Submarino</em>: línea de 5 (↔/↕).</li>
              </ul>
              <div className="sea2-help__note">
                Nota: estas armas están implementadas como patrones de ataque (con munición). Si quieres que el modo avanzado siga reglas exactas de “Sea Battle 2” (cooldowns, efectos especiales, etc.), dime las reglas y lo ajusto.
              </div>
            </div>
          </div>
        </Modal>
      </Card>
    </Layout>
  );
}

export default SeaBattle2;
