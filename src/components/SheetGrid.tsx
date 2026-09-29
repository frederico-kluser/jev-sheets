import { useMemo } from "react";
import { AllCommunityModule, ModuleRegistry, type ColDef } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import type { ColumnMeta, RowAnalysis, SheetRow } from "../../shared/types";
import { TEMP_COLUMN_ID, TEMP_COLUMN_NAME } from "../../shared/types";
import { VerdictCell } from "./VerdictCell";

ModuleRegistry.registerModules([AllCommunityModule]);

interface SheetGridProps {
  columns: ColumnMeta[];
  rows: SheetRow[];
  /** Resultados do último envio, por rowId (usado em classes e tooltips). */
  results: Map<string, RowAnalysis>;
  onCellEdit: (rowId: string, key: string, value: string) => void;
}

/**
 * Planilha completa (AG Grid Community): edição, ordenação, filtros, resize,
 * reordenação, seleção, paginação, navegação por teclado e exportação CSV.
 *
 * A coluna temporária do filtro IA (SIM/NÃO) já existe no grid, mas fica
 * sempre limpa até um envio; cada célula editada limpa o resultado da linha.
 */
export function SheetGrid({ columns, rows, results, onCellEdit }: SheetGridProps) {
  const columnDefs = useMemo<ColDef[]>(() => {
    const dataCols: ColDef[] = columns.map((c, index) => ({
      field: c.key,
      headerName: c.name,
      editable: true,
      filter: true,
      sortable: true,
      resizable: true,
      minWidth: 110,
      enableCellChangeFlash: true,
      // A coluna de identificação fica fixada: sem perder a linha em scroll horizontal.
      ...(index === 0 ? { pinned: "left" as const } : {}),
    }));
    const aiCol: ColDef = {
      colId: TEMP_COLUMN_ID,
      field: TEMP_COLUMN_ID,
      headerName: TEMP_COLUMN_NAME,
      editable: false,
      sortable: true,
      filter: true,
      resizable: true,
      minWidth: 190,
      // Fixada à direita: os vereditos ficam sempre visíveis durante o scroll.
      pinned: "right",
      cellRenderer: VerdictCell,
      cellClassRules: {
        "ai-verdict ai-sim": (p) => p.value === "SIM",
        "ai-verdict ai-nao": (p) => p.value === "NÃO",
        "ai-verdict ai-erro": (p) => p.value === "ERRO",
        "ai-source-cache": (p) => results.get(String(p.data?.id))?.source === "cache",
        // Incerteza do Jev visível: banda hitl ganha contorno tracejado.
        "ai-band-hitl": (p) => results.get(String(p.data?.id))?.band === "hitl",
      },
      tooltipValueGetter: (p) => {
        const r = results.get(String(p.data?.id));
        if (!r || r.probability === null) return "";
        return `p(aderente) = ${r.probability} · banda ${r.band} · fonte ${r.source}`;
      },
    };
    return [...dataCols, aiCol];
  }, [columns, results]);

  return (
    <div className="grid-shell">
      <AgGridReact<SheetRow>
        rowData={rows}
        columnDefs={columnDefs}
        getRowId={(params) => params.data.id}
        defaultColDef={{ flex: 1, minWidth: 90, filter: "agTextColumnFilter" }}
        pagination
        paginationPageSize={10}
        paginationPageSizeSelector={[10, 20, 50]}
        animateRows
        rowSelection="multiple"
        undoRedoCellEditing
        undoRedoCellEditingLimit={20}
        onCellValueChanged={(event) => {
          const colId = event.column.getColId();
          if (colId !== TEMP_COLUMN_ID) {
            onCellEdit(String(event.data.id), colId, String(event.newValue ?? ""));
          }
        }}
      />
    </div>
  );
}
