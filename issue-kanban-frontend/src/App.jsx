import { useState, useEffect } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import "./App.css";

const API_BASE = "http://127.0.0.1:5000";
const COLUMN_ORDER = ["Backlog", "Todo", "Doing", "Done"];

const COLUMN_CLASSES = {
  Backlog: "col-backlog",
  Todo:    "col-todo",
  Doing:   "col-doing",
  Done:    "col-done",
};

// Label chip colours — hashed by name for consistency
const LABEL_PALETTES = [
  { bg: "rgba(59,130,246,0.12)",  border: "rgba(59,130,246,0.3)",  color: "#93c5fd" },
  { bg: "rgba(168,85,247,0.12)",  border: "rgba(168,85,247,0.3)",  color: "#c4b5fd" },
  { bg: "rgba(34,197,94,0.12)",   border: "rgba(34,197,94,0.3)",   color: "#86efac" },
  { bg: "rgba(249,115,22,0.12)",  border: "rgba(249,115,22,0.3)",  color: "#fdba74" },
  { bg: "rgba(236,72,153,0.12)",  border: "rgba(236,72,153,0.3)",  color: "#f9a8d4" },
  { bg: "rgba(20,184,166,0.12)",  border: "rgba(20,184,166,0.3)",  color: "#5eead4" },
];

function hashLabel(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return h % LABEL_PALETTES.length;
}

function customCollisionDetection(args) {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return rectIntersection(args);
}

function findColumnForCard(board, cardId) {
  for (const column of board.columns) {
    if (column.cards.some((card) => String(card.id) === String(cardId)))
      return column.name;
  }
  return null;
}

function findCardById(board, cardId) {
  for (const column of board.columns) {
    const card = column.cards.find((card) => String(card.id) === String(cardId));
    if (card) return card;
  }
  return null;
}

const WORKFLOW_LABELS = new Set(["todo", "to-do", "ready", "next", "in progress", "doing", "active"]);

function labelsForColumn(existingLabels, targetColumn) {
  const nonWorkflow = existingLabels.filter(l => !WORKFLOW_LABELS.has(l.toLowerCase()));
  if (targetColumn === "Todo")    return [...nonWorkflow, "todo"];
  if (targetColumn === "Doing")   return [...nonWorkflow, "in progress"];
  return nonWorkflow; // Backlog and Done get no workflow label
}

function moveCardInBoard(board, cardId, sourceColumnName, targetColumnName) {
  if (sourceColumnName === targetColumnName) return board;

  const nextColumns = board.columns.map((col) => ({
    ...col,
    cards: [...col.cards],
  }));

  const sourceColumn = nextColumns.find((c) => c.name === sourceColumnName);
  const targetColumn = nextColumns.find((c) => c.name === targetColumnName);
  if (!sourceColumn || !targetColumn) return board;

  const cardIndex = sourceColumn.cards.findIndex(
    (card) => String(card.id) === String(cardId)
  );
  if (cardIndex === -1) return board;

  const [movedCard] = sourceColumn.cards.splice(cardIndex, 1);
  const updatedCard = {
    ...movedCard,
    labels: labelsForColumn(movedCard.labels || [], targetColumnName),
  };
  targetColumn.cards.unshift(updatedCard);

  return { ...board, columns: nextColumns };
}

// ── Issue detail modal ───────────────────────────────────────
function IssueModal({ card, onClose }) {
  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={handleBackdropClick}>
      <div className="modal">
        <div className="modal-header">
          <div className="modal-meta">
            <span className="modal-id">Issue #{card.id}</span>
            <h2 className="modal-title">{card.title}</h2>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="modal-body">
          {card.body
            ? <p className="modal-description">{card.body}</p>
            : <p className="modal-description-empty">No description provided.</p>
          }

          {card.assignees?.length > 0 && (
            <div className="modal-section">
              <div className="modal-section-label">Assignees</div>
              <div style={{ display: "flex", gap: 6 }}>
                {card.assignees.map((a) => (
                  <div key={a} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <Avatar login={a} />
                    <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>{a}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <div className="modal-labels">
            {card.labels?.map((l) => <LabelChip key={l} label={l} />)}
          </div>
          {card.url && (
            <a href={card.url} target="_blank" rel="noreferrer" className="modal-gh-link">
              View on GitHub ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Label chip ───────────────────────────────────────────────
function LabelChip({ label }) {
  const palette = LABEL_PALETTES[hashLabel(label)];
  return (
    <span
      className="label-chip"
      style={{
        background: palette.bg,
        borderColor: palette.border,
        color: palette.color,
      }}
    >
      {label}
    </span>
  );
}

// ── Avatar ───────────────────────────────────────────────────
function Avatar({ login }) {
  return <div className="avatar">{login.slice(0, 2)}</div>;
}

// ── Card content (shared between drag overlay and sortable) ──
function CardContent({ card, dragging = false, onCardClick }) {
  return (
    <div
      className={`card${dragging ? " dragging" : ""}`}
      onClick={onCardClick ? (e) => { e.stopPropagation(); onCardClick(card); } : undefined}
    >
      <div className="card-header">
        <span className="card-id">#{card.id}</span>
        {card.url && (
          <a
            href={card.url}
            target="_blank"
            rel="noreferrer"
            className="gh-link"
            onClick={(e) => e.stopPropagation()}
          >
            ↗ GitHub
          </a>
        )}
      </div>

      <p className="card-title">{card.title}</p>

      {card.body && <p className="card-body">{card.body}</p>}

      {(card.labels?.length > 0 || card.assignees?.length > 0) && (
        <div className="card-footer">
          <div className="card-labels">
            {card.labels?.map((l) => (
              <LabelChip key={l} label={l} />
            ))}
          </div>
          <div className="assignees">
            {card.assignees?.map((a) => (
              <Avatar key={a} login={a} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sortable card ────────────────────────────────────────────
function SortableCard({ card, onCardClick }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({
      id: `card-${card.id}`,
      data: { type: "card", cardId: card.id },
    });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
      }}
      {...attributes}
      {...listeners}
    >
      <CardContent card={card} onCardClick={onCardClick} />
    </div>
  );
}

// ── Column ───────────────────────────────────────────────────
function Column({ name, cards, onCardClick }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${name}`,
    data: { type: "column", columnName: name },
  });

  const colClass = COLUMN_CLASSES[name] || "";

  return (
    <div
      ref={setNodeRef}
      className={`column ${colClass}${isOver ? " is-over" : ""}`}
    >
      <div className="column-header">
        <span className="status-dot" />
        <h3>{name}</h3>
        <span className="count">{cards.length}</span>
      </div>

      <SortableContext
        items={cards.map((card) => `card-${card.id}`)}
        strategy={verticalListSortingStrategy}
      >
        {cards.map((card) => (
          <SortableCard key={card.id} card={card} onCardClick={onCardClick} />
        ))}

        {cards.length === 0 && (
          <div className="empty-placeholder">no issues here</div>
        )}
      </SortableContext>
    </div>
  );
}

// ── Loading overlay ──────────────────────────────────────────
function LoadingOverlay({ message = "Fetching issues…" }) {
  return (
    <div className="loading-overlay">
      <div className="loading-card">
        <div className="dot-spinner">
          <span /><span /><span />
        </div>
        <div className="loading-label">{message}</div>
      </div>
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────
export default function App() {
  const [repo, setRepo]               = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [board, setBoard]             = useState(null);
  const [error, setError]             = useState("");
  const [isLoading, setIsLoading]     = useState(false);
  const [isMoving, setIsMoving]       = useState(false);
  const [activeCardId, setActiveCardId] = useState(null);
  const [selectedCard, setSelectedCard] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  async function loadBoard(e) {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/kanban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo, github_token: githubToken }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data["bruh moment"] || "failed");

      setBoard(data.board);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }

  function handleDragStart(event) {
    const { active } = event;
    if (!active) return;
    if (String(active.id).startsWith("card-"))
      setActiveCardId(String(active.id).replace("card-", ""));
  }

  function handleDragCancel() {
    setActiveCardId(null);
  }

  async function handleDragEnd(event) {
    const { active, over } = event;

    if (!active || !over || !board || isMoving) {
      setActiveCardId(null);
      return;
    }

    const activeId = active.id;
    const overId   = over.id;

    if (!String(activeId).startsWith("card-")) {
      setActiveCardId(null);
      return;
    }

    const issueNumber    = String(activeId).replace("card-", "");
    const sourceColumnName = findColumnForCard(board, issueNumber);

    let targetColumnName = null;
    if (String(overId).startsWith("column-"))
      targetColumnName = String(overId).replace("column-", "");
    else if (String(overId).startsWith("card-"))
      targetColumnName = findColumnForCard(board, String(overId).replace("card-", ""));

    if (!sourceColumnName || !targetColumnName || sourceColumnName === targetColumnName) {
      setActiveCardId(null);
      return;
    }

    const previousBoard   = board;
    const optimisticBoard = moveCardInBoard(board, issueNumber, sourceColumnName, targetColumnName);

    setBoard(optimisticBoard);
    setIsMoving(true);
    setError("");

    try {
      const res = await fetch(`${API_BASE}/move-issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo,
          github_token: githubToken,
          issue_number: Number(issueNumber),
          target_column: targetColumnName,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data["bruh moment"] || "failed to move issue");
    } catch (err) {
      setBoard(previousBoard);
      setError(err.message);
    } finally {
      setIsMoving(false);
      setActiveCardId(null);
    }
  }

  const normalizedBoard = board
    ? {
        ...board,
        columns: COLUMN_ORDER.map(
          (name) =>
            board.columns.find((c) => c.name === name) || { name, cards: [] }
        ),
      }
    : null;

  const activeCard =
    normalizedBoard && activeCardId
      ? findCardById(normalizedBoard, activeCardId)
      : null;

  return (
    <div className="app-container">
      {/* Syncing top-bar */}
      {isMoving && <div className="sync-bar" />}

      {/* Full-screen loading overlay */}
      {isLoading && <LoadingOverlay message="Generating board…" />}

      {/* Header */}
      <header className="app-header">
        <div className="app-wordmark">
          <h1>Kanban</h1>
          <span>GitHub Issues Board</span>
        </div>

        <form className="config-form" onSubmit={loadBoard}>
          <input
            placeholder="owner / repo"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="GitHub token"
            value={githubToken}
            onChange={(e) => setGithubToken(e.target.value)}
            required
          />
          <button type="submit" disabled={isLoading || isMoving}>
            {isLoading ? "Loading…" : "Load Board"}
          </button>
        </form>
      </header>

      {/* Error */}
      {error && <div className="error-banner">{error}</div>}

      {/* Empty state */}
      {!normalizedBoard && !isLoading && (
        <div className="empty-state">
          <div className="empty-state-icon">⬛</div>
          <h2>No board loaded</h2>
          <p>Enter a GitHub repo and token above to generate a Kanban board from its issues.</p>
        </div>
      )}

      {/* Board */}
      {normalizedBoard && (
        <DndContext
          sensors={sensors}
          collisionDetection={customCollisionDetection}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="kanban-grid">
            {COLUMN_ORDER.map((name) => {
              const column =
                normalizedBoard.columns.find((c) => c.name === name) || {
                  name,
                  cards: [],
                };
              return <Column key={name} name={name} cards={column.cards} onCardClick={setSelectedCard} />;
            })}
          </div>

          <DragOverlay dropAnimation={null}>
            {activeCard ? <CardContent card={activeCard} dragging /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Issue detail modal */}
      {selectedCard && (
        <IssueModal card={selectedCard} onClose={() => setSelectedCard(null)} />
      )}
    </div>
  );
}
