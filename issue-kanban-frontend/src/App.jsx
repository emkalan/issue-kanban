import { useState } from "react";
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

const API_BASE = "http://127.0.0.1:5000";
const COLUMN_ORDER = ["Backlog", "Todo", "Doing", "Done"];

function customCollisionDetection(args) {
  const pointerCollisions = pointerWithin(args);

  if (pointerCollisions.length > 0) {
    return pointerCollisions;
  }

  return rectIntersection(args);
}

function findColumnForCard(board, cardId) {
  for (const column of board.columns) {
    if (column.cards.some((card) => String(card.id) === String(cardId))) {
      return column.name;
    }
  }
  return null;
}

function findCardById(board, cardId) {
  for (const column of board.columns) {
    const card = column.cards.find((card) => String(card.id) === String(cardId));
    if (card) {
      return card;
    }
  }
  return null;
}

function moveCardInBoard(board, cardId, sourceColumnName, targetColumnName) {
  if (sourceColumnName === targetColumnName) {
    return board;
  }

  const nextColumns = board.columns.map((col) => ({
    ...col,
    cards: [...col.cards],
  }));

  const sourceColumn = nextColumns.find((c) => c.name === sourceColumnName);
  const targetColumn = nextColumns.find((c) => c.name === targetColumnName);

  if (!sourceColumn || !targetColumn) {
    return board;
  }

  const cardIndex = sourceColumn.cards.findIndex(
    (card) => String(card.id) === String(cardId)
  );

  if (cardIndex === -1) {
    return board;
  }

  const [movedCard] = sourceColumn.cards.splice(cardIndex, 1);
  targetColumn.cards.unshift(movedCard);

  return {
    ...board,
    columns: nextColumns,
  };
}

function CardContent({ card, dragging = false }) {
  return (
    <div
      style={{
        background: "white",
        padding: 10,
        marginBottom: 10,
        borderRadius: 6,
        boxShadow: dragging ? "0 10px 24px rgba(0,0,0,0.18)" : "none",
        opacity: dragging ? 0.95 : 1,
      }}
    >
      <strong>
        #{card.id} {card.title}
      </strong>

      <p style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{card.body}</p>

      <a href={card.url} target="_blank" rel="noreferrer">
        open on github
      </a>
    </div>
  );
}

function SortableCard({ card }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: `card-${card.id}`,
    data: {
      type: "card",
      cardId: card.id,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    cursor: "grab",
    opacity: isDragging ? 0.35 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <CardContent card={card} />
    </div>
  );
}

function Column({ name, cards }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${name}`,
    data: {
      type: "column",
      columnName: name,
    },
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        background: isOver ? "#ddd" : "#eee",
        padding: 10,
        borderRadius: 10,
        minHeight: 300,
      }}
    >
      <h3>{name}</h3>

      <SortableContext
        items={cards.map((card) => `card-${card.id}`)}
        strategy={verticalListSortingStrategy}
      >
        {cards.map((card) => (
          <SortableCard key={card.id} card={card} />
        ))}

        {cards.length === 0 && (
          <div
            style={{
              minHeight: 120,
              border: "2px dashed #bbb",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#666",
              background: "#f8f8f8",
            }}
          >
            Drop here
          </div>
        )}
      </SortableContext>
    </div>
  );
}

export default function App() {
  const [repo, setRepo] = useState("");
  const [githubToken, setGithubToken] = useState("");
  const [board, setBoard] = useState(null);
  const [error, setError] = useState("");
  const [isMoving, setIsMoving] = useState(false);
  const [activeCardId, setActiveCardId] = useState(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  async function loadBoard(e) {
    e.preventDefault();
    setError("");

    try {
      const res = await fetch(`${API_BASE}/kanban`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repo,
          github_token: githubToken,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data["bruh moment"] || "failed");
      }

      setBoard(data.board);
    } catch (err) {
      setError(err.message);
    }
  }

  function handleDragStart(event) {
    const { active } = event;

    if (!active) {
      return;
    }

    if (String(active.id).startsWith("card-")) {
      const issueNumber = String(active.id).replace("card-", "");
      setActiveCardId(issueNumber);
    }
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
    const overId = over.id;

    if (!String(activeId).startsWith("card-")) {
      setActiveCardId(null);
      return;
    }

    const issueNumber = String(activeId).replace("card-", "");
    const sourceColumnName = findColumnForCard(board, issueNumber);

    let targetColumnName = null;

    if (String(overId).startsWith("column-")) {
      targetColumnName = String(overId).replace("column-", "");
    } else if (String(overId).startsWith("card-")) {
      targetColumnName = findColumnForCard(
        board,
        String(overId).replace("card-", "")
      );
    }

    if (!sourceColumnName || !targetColumnName) {
      setActiveCardId(null);
      return;
    }

    if (sourceColumnName === targetColumnName) {
      setActiveCardId(null);
      return;
    }

    const previousBoard = board;
    const optimisticBoard = moveCardInBoard(
      board,
      issueNumber,
      sourceColumnName,
      targetColumnName
    );

    setBoard(optimisticBoard);
    setIsMoving(true);
    setError("");

    try {
      const res = await fetch(`${API_BASE}/move-issue`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          repo,
          github_token: githubToken,
          issue_number: Number(issueNumber),
          target_column: targetColumnName,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data["bruh moment"] || "failed to move issue");
      }
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
      columns: COLUMN_ORDER.map((name) => {
        return (
          board.columns.find((c) => c.name === name) || { name, cards: [] }
        );
      }),
    }
    : null;

  const activeCard =
    normalizedBoard && activeCardId
      ? findCardById(normalizedBoard, activeCardId)
      : null;

  return (
    <div style={{ padding: 30, fontFamily: "sans-serif" }}>
      <h1>GitHub Issue Kanban</h1>

      <form onSubmit={loadBoard} style={{ marginBottom: 20 }}>
        <input
          placeholder="owner/repo"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          style={{ marginRight: 10 }}
        />

        <input
          type="password"
          placeholder="GitHub token"
          value={githubToken}
          onChange={(e) => setGithubToken(e.target.value)}
          style={{ marginRight: 10 }}
        />

        <button type="submit" disabled={isMoving}>
          {isMoving ? "Moving..." : "Load Board"}
        </button>
      </form>

      {error && <div style={{ color: "red", marginBottom: 16 }}>{error}</div>}

      {normalizedBoard && (
        <DndContext
          sensors={sensors}
          collisionDetection={customCollisionDetection}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 20,
            }}
          >
            {COLUMN_ORDER.map((name) => {
              const column =
                normalizedBoard.columns.find((c) => c.name === name) || {
                  name,
                  cards: [],
                };

              return <Column key={name} name={name} cards={column.cards} />;
            })}
          </div>

          <DragOverlay>
            {activeCard ? <CardContent card={activeCard} dragging /> : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}