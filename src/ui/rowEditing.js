function rowSnapshot(project, id) {
  for (const material of project.materials) {
    if (material.id === id) {
      return {
        kind: 'material',
        value: structuredClone({
          name: material.name,
          thicknessIn: material.thicknessIn,
          thicknessLabel: material.thicknessLabel,
          note: material.note,
          widthIn: material.widthIn,
        }),
      };
    }
    const sheetIndex = material.sheets.findIndex((candidate) => candidate.id === id);
    if (sheetIndex !== -1) return {
      kind: 'sheet', ownerId: material.id, ownerIndex: sheetIndex, value: structuredClone(material.sheets[sheetIndex]),
    };
    const boardIndex = material.boards.findIndex((candidate) => candidate.id === id);
    if (boardIndex !== -1) return {
      kind: 'board', ownerId: material.id, ownerIndex: boardIndex, value: structuredClone(material.boards[boardIndex]),
    };
  }
  const part = project.parts.find((candidate) => candidate.id === id);
  if (part) return { kind: 'part', value: structuredClone(part) };
  const supply = project.supplies.find((candidate) => candidate.id === id);
  if (supply) return { kind: 'supply', value: structuredClone(supply) };
  return null;
}

export function beginRowEditing(uiState, id, project) {
  const current = uiState.get(id) ?? {};
  if (current.editing === true) return;
  const priorState = { ...current };
  delete priorState.editing;
  delete priorState.editSnapshot;
  uiState.set(id, {
    ...current,
    editing: true,
    editSnapshot: { row: rowSnapshot(project, id), priorState },
  });
}

export function finishRowEditing(uiState, id) {
  const state = { ...(uiState.get(id) ?? {}), editing: false };
  delete state.editSnapshot;
  uiState.set(id, state);
}

export function cancelRowEditing(uiState, project, id) {
  const snapshot = uiState.get(id)?.editSnapshot;
  if (!snapshot?.row) {
    finishRowEditing(uiState, id);
    return;
  }
  const { row } = snapshot;
  if (row.kind === 'material') {
    const material = project.materials.find((candidate) => candidate.id === id);
    if (material) Object.assign(material, structuredClone(row.value));
  } else if (row.kind === 'sheet' || row.kind === 'board') {
    const collection = row.kind === 'sheet' ? 'sheets' : 'boards';
    let currentIndex = -1;
    let currentOwner = null;
    for (const material of project.materials) {
      const index = material[collection].findIndex((candidate) => candidate.id === id);
      if (index !== -1) {
        currentIndex = index;
        currentOwner = material;
        break;
      }
    }
    const originalOwner = project.materials.find((material) => material.id === row.ownerId);
    if (currentOwner && originalOwner) {
      currentOwner[collection].splice(currentIndex, 1);
      originalOwner[collection].splice(Math.min(row.ownerIndex, originalOwner[collection].length), 0, structuredClone(row.value));
    }
  } else {
    const collection = row.kind === 'part' ? project.parts : project.supplies;
    const index = collection.findIndex((candidate) => candidate.id === id);
    if (index !== -1) collection[index] = structuredClone(row.value);
  }
  uiState.set(id, { ...snapshot.priorState, editing: false });
}

export function finishAllRowEdits(uiState) {
  for (const [rowId, state] of uiState) {
    const committed = { ...state, editing: false };
    delete committed.editSnapshot;
    uiState.set(rowId, committed);
  }
}
